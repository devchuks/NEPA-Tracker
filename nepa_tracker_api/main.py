import os
import asyncio
import threading
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, BackgroundTasks, HTTPException, Security
from fastapi.security.api_key import APIKeyHeader
from sqlalchemy import create_engine, Column, Integer, DateTime, String, Boolean
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from datetime import datetime, timedelta
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, Literal
import calendar
from calendar import monthrange
from telegram_service import send_telegram_alert
from export_service import generate_nepa_csv_stream
import logging
import secrets

# --- DATABASE SETUP ---
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./nepa.db")
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class PowerStatus(Base):
    __tablename__ = "power_status"
    id = Column(Integer, primary_key=True)
    last_ping = Column(DateTime, default=datetime.now)
    is_online = Column(Boolean, default=True)
    source = Column(String, default="NEPA")

class PowerLog(Base):
    __tablename__ = "power_logs"
    id = Column(Integer, primary_key=True)
    event = Column(String) 
    source = Column(String, nullable=True)
    timestamp = Column(DateTime, default=datetime.now)

Base.metadata.create_all(bind=engine)

def get_db():
    db = SessionLocal()
    try: yield db
    finally: db.close()

# --- SECURITY SETUP ---
# In production, set this in your .env or Render dashboard!
SECRET_TOKEN = os.getenv("ADMIN_SECRET_TOKEN")
if not SECRET_TOKEN:
    print("⚠️ WARNING: ADMIN_SECRET_TOKEN is not set. Admin endpoints will be locked.")
header_scheme = APIKeyHeader(name="X-Admin-Token")

def verify_admin(token: str = Security(header_scheme)):
    if not SECRET_TOKEN or not secrets.compare_digest(token, SECRET_TOKEN):
        raise HTTPException(status_code=403, detail="Forbidden: Invalid or missing token")
    return token

# --- EVENT BUS ARCHITECTURE ---
class EventBus:
    def __init__(self):
        self._subscribers = {}

    def subscribe(self, event_type: str, handler):
        if event_type not in self._subscribers:
            self._subscribers[event_type] = []
        self._subscribers[event_type].append(handler)

    def emit(self, event_type: str, *args, **kwargs):
        for handler in self._subscribers.get(event_type, []):
            asyncio.create_task(handler(*args, **kwargs))

bus = EventBus()

# --- ASYNC WATCHDOG TIMER ---
class WatchdogTimer:
    def __init__(self, timeout=75):
        self.timeout = timeout
        self.task = None
        self.last_ping_time = datetime.min

    async def _countdown(self, scheduled_ping_time: datetime):
        try:
            await asyncio.sleep(self.timeout)
            
            # RACE CONDITION KILLER: If a newer ping arrived while we were sleeping, abort!
            if self.last_ping_time > scheduled_ping_time:
                return
                
            death_time = scheduled_ping_time + timedelta(seconds=self.timeout)
            bus.emit("POWER_LOST", death_time)
        except asyncio.CancelledError:
            pass

    def reset(self, ping_time: datetime):
        self.last_ping_time = ping_time
        if self.task and not self.task.done():
            self.task.cancel()
        self.task = asyncio.create_task(self._countdown(ping_time))

watchdog = WatchdogTimer()

# --- STATE LOCK (PREVENTS RACE CONDITIONS) ---
state_lock = asyncio.Lock()

# --- EVENT HANDLERS ---
async def handle_ping(timestamp: datetime):
    async with state_lock:
        with SessionLocal() as db:
            status = db.query(PowerStatus).filter(PowerStatus.id == 1).first()
            formatted_time = timestamp.strftime('%I:%M:%S %p')
            alert_msg = f"🟢 POWER RESTORED\nTime: {formatted_time}"

            if not status:
                status = PowerStatus(id=1, last_ping=timestamp, is_online=True, source="NEPA")
                db.add(status)
                db.add(PowerLog(event="ON", source="NEPA", timestamp=timestamp))
                db.commit()
                await asyncio.to_thread(send_telegram_alert, alert_msg)
            else:
                status.last_ping = timestamp
                if not status.is_online:
                    status.is_online = True
                    db.add(PowerLog(event="ON", source=status.source, timestamp=timestamp))
                    db.commit()
                    await asyncio.to_thread(send_telegram_alert, alert_msg)
                else:
                    db.commit()

async def handle_power_lost(death_time: datetime):
    async with state_lock:
        with SessionLocal() as db:
            status = db.query(PowerStatus).filter(PowerStatus.id == 1).first()
            if status and status.is_online:
                status.is_online = False
                db.add(PowerLog(event="OFF", source=None, timestamp=death_time))
                db.commit()
                formatted_time = death_time.strftime('%I:%M:%S %p')
                alert_msg = f"🔴 POWER LOST\nTime: {formatted_time}"
                await asyncio.to_thread(send_telegram_alert, alert_msg)

async def handle_source_change(new_source: str):
    async with state_lock:
        with SessionLocal() as db:
            status = db.query(PowerStatus).filter(PowerStatus.id == 1).first()
            if status:
                status.source = new_source
                
            last_log = db.query(PowerLog).order_by(PowerLog.timestamp.desc()).first()
            if last_log and last_log.event == "ON":
                last_log.source = new_source
            db.commit()

bus.subscribe("PING_RECEIVED", handle_ping)
bus.subscribe("POWER_LOST", handle_power_lost)
bus.subscribe("SOURCE_CHANGED", handle_source_change)

# --- FASTAPI APP ---
@asynccontextmanager
async def lifespan(app: FastAPI):
    with SessionLocal() as db:
        status = db.query(PowerStatus).filter(PowerStatus.id == 1).first()
        if status and status.is_online:
            elapsed = (datetime.now() - status.last_ping).total_seconds()
            if elapsed > watchdog.timeout:
                bus.emit("POWER_LOST", status.last_ping + timedelta(seconds=watchdog.timeout))
            else:
                watchdog.reset(status.last_ping)
    yield
    if watchdog.task: watchdog.task.cancel()

app = FastAPI(lifespan=lifespan)

# --- SILENCE HEARTBEAT LOGS ---
class PingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        # Ignore any log message that contains the ping endpoint
        return record.getMessage().find("POST /api/ping") == -1

# Apply the silencer to Uvicorn's access logger
logging.getLogger("uvicorn.access").addFilter(PingFilter())

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "https://nepa-tracker.netlify.app"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- PYDANTIC SCHEMAS ---
class SourceToggle(BaseModel):
    source: Literal["NEPA", "GEN"] # Security Fix: Input validation

class LogEntry(BaseModel):
    event: str
    source: Optional[str] = None
    timestamp: datetime

class BulkDelete(BaseModel):
    log_ids: list[int]

# --- CORE TELEMETRY ENDPOINTS ---
@app.get("/")
def health_check():
    return {"app": "NepaTracker API", "status": "Online"}

@app.post("/api/ping", dependencies=[Depends(verify_admin)])
async def receive_ping():
    now = datetime.now()
    watchdog.reset(now)
    bus.emit("PING_RECEIVED", now)
    return {"message": "Event Dispatched: Ping"}

@app.post("/api/source", dependencies=[Depends(verify_admin)])
async def toggle_source(data: SourceToggle):
    bus.emit("SOURCE_CHANGED", data.source)
    return {"message": "Event Dispatched: Source Change", "source": data.source}

@app.get("/api/status")
def get_status(db: Session = Depends(get_db)):
    status = db.query(PowerStatus).filter(PowerStatus.id == 1).first()
    if not status: return {"nepa": "OFF", "source": "NEPA"}
    return {"nepa": "ON" if status.is_online else "OFF", "source": status.source}

# --- ANALYTICS ENDPOINTS ---
@app.get("/api/logs")
def get_logs(db: Session = Depends(get_db)):
    return db.query(PowerLog).order_by(PowerLog.timestamp.desc(), PowerLog.id.desc()).limit(8).all()

@app.get("/api/analytics/master")
def get_master_analytics(date: str, timeframe: str = "day", db: Session = Depends(get_db)):
    try:
        target_dt = datetime.strptime(date, "%Y-%m-%d")
        
        if timeframe == "day":
            start_dt = target_dt
            end_dt = start_dt + timedelta(days=1)
        elif timeframe == "week":
            start_dt = target_dt - timedelta(days=target_dt.weekday())
            end_dt = start_dt + timedelta(days=7)
        elif timeframe == "month":
            start_dt = target_dt.replace(day=1)
            _, days_in_month = monthrange(start_dt.year, start_dt.month)
            end_dt = start_dt + timedelta(days=days_in_month)
        elif timeframe == "year":
            start_dt = target_dt.replace(month=1, day=1)
            end_dt = start_dt.replace(year=start_dt.year + 1)
            
        now = datetime.now()
        math_end_dt = min(end_dt, now)
            
        initial_log = db.query(PowerLog).filter(PowerLog.timestamp <= start_dt).order_by(PowerLog.timestamp.desc(), PowerLog.id.desc()).first()
        logs = db.query(PowerLog).filter(PowerLog.timestamp >= start_dt, PowerLog.timestamp < math_end_dt).order_by(PowerLog.timestamp.asc(), PowerLog.id.asc()).all()
        
        timeline = []
        if initial_log:
            timeline.append(PowerLog(event=initial_log.event, source=initial_log.source, timestamp=start_dt))
        else:
            timeline.append(PowerLog(event="OFF", source="OFFLINE", timestamp=start_dt))
            
        timeline.extend(logs)
        timeline.append(PowerLog(event="END", source="END", timestamp=math_end_dt)) 
        
        stats = {"NEPA": 0, "GEN": 0, "OFF": 0}
        trend = []
        
        if timeframe == "day":
            for i in range(len(timeline) - 1):
                curr, nxt = timeline[i], timeline[i+1]
                dur = (nxt.timestamp - curr.timestamp).total_seconds() / 3600
                level = 1 if curr.event == "ON" else 0
                source = curr.source if curr.event == "ON" else "OFFLINE"
                trend.append({
                    "time": curr.timestamp.strftime("%H:%M"), 
                    "timestamp": int(curr.timestamp.timestamp() * 1000),
                    "level": level, 
                    "status": source
                })
                if curr.event == "ON": stats[curr.source] = stats.get(curr.source, 0) + dur
                else: stats["OFF"] += dur
                
            last = timeline[-2]
            trend.append({
                "time": "23:59", 
                "timestamp": int(math_end_dt.timestamp() * 1000),
                "level": 1 if last.event=="ON" else 0, 
                "status": last.source if last.event=="ON" else "OFFLINE"
            })
        
        else:
            buckets = []
            if timeframe == "week":
                for i in range(7):
                    day_start = start_dt + timedelta(days=i)
                    buckets.append({"name": calendar.day_abbr[day_start.weekday()], "start": day_start, "end": day_start + timedelta(days=1), "Grid": 0, "Gen": 0})
            elif timeframe == "month":
                _, days = monthrange(start_dt.year, start_dt.month)
                for i in range(days):
                    day_start = start_dt + timedelta(days=i)
                    buckets.append({"name": str(i+1), "start": day_start, "end": day_start + timedelta(days=1), "Grid": 0, "Gen": 0})
            elif timeframe == "year":
                for i in range(12):
                    month_start = start_dt.replace(month=i+1)
                    _, days = monthrange(month_start.year, month_start.month)
                    month_end = month_start + timedelta(days=days)
                    buckets.append({"name": calendar.month_abbr[i+1][0], "start": month_start, "end": month_end, "Grid": 0, "Gen": 0})

            outage_count = 0
            for i in range(len(timeline) - 1):
                curr, nxt = timeline[i], timeline[i+1]
                if curr.event == "ON":
                    ev_start = curr.timestamp
                    ev_end = nxt.timestamp
                    stats[curr.source] = stats.get(curr.source, 0) + (ev_end - ev_start).total_seconds() / 3600
                    
                    for b in buckets:
                        # OPTIMIZATION: Skip buckets that don't intersect
                        if b["end"] <= ev_start:
                            continue
                        if b["start"] >= ev_end:
                            break # Buckets are chronological, so we can safely stop checking the rest!
                            
                        overlap_start = max(ev_start, b["start"])
                        overlap_end = min(ev_end, b["end"])
                        if overlap_start < overlap_end:
                            dur = (overlap_end - overlap_start).total_seconds() / 3600
                            if curr.source == "NEPA": b["Grid"] += dur
                            elif curr.source == "GEN": b["Gen"] += dur
                else:
                    stats["OFF"] += (nxt.timestamp - curr.timestamp).total_seconds() / 3600
                    if curr.timestamp >= start_dt:
                        outage_count += 1

            for b in buckets:
                trend.append({
                    "name": b["name"],
                    "Grid": round(b["Grid"], 1),
                    "Gen": round(b["Gen"], 1)
                })

        total_hours = sum(stats.values())
        uptime_pct = round(((stats.get("NEPA", 0) + stats.get("GEN", 0)) / total_hours) * 100) if total_hours > 0 else 0
        
        return {
            "trend": trend,
            "distribution": [
                {"name": "Grid", "value": round(stats.get("NEPA", 0), 1), "color": "#ec4899"},
                {"name": "Gen", "value": round(stats.get("GEN", 0), 1), "color": "#f59e0b"},
                {"name": "Off", "value": round(stats.get("OFF", 0), 1), "color": "#94a3b8"}
            ],
            "kpis": {
                "uptime": f"{uptime_pct}%",
                "grid_hours": f"{round(stats.get('NEPA', 0), 1)}h",
                "outages": outage_count if timeframe != "day" else len([l for l in logs if l.event == "OFF" and l.timestamp >= start_dt and l.timestamp < math_end_dt])
            }
        }
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format provided.")
    except Exception as e:
        raise HTTPException(status_code=500, detail="An internal server error occurred.")

@app.get("/api/analytics/monthly/{year}/{month}")
def get_monthly_averages(year: int, month: int, db: Session = Depends(get_db)):
    start_date = datetime(year, month, 1)
    if month == 12:
        end_date = datetime(year + 1, 1, 1)
    else:
        end_date = datetime(year, month + 1, 1)

    logs = db.query(PowerLog).filter(
        PowerLog.timestamp >= start_date,
        PowerLog.timestamp < end_date
    ).order_by(PowerLog.timestamp.asc(), PowerLog.id.asc()).all()

    if not logs:
        return {"avg_grid": "0h", "frequency": "0/day", "uptime": "0%"}

    stats = {"NEPA": 0, "GEN": 0, "OFF": 0}
    outage_count = 0
    
    for i in range(len(logs) - 1):
        curr, nxt = logs[i], logs[i+1]
        duration = (nxt.timestamp - curr.timestamp).total_seconds() / 3600
        if curr.event == "ON":
            stats[curr.source] = stats.get(curr.source, 0) + duration
        else:
            stats["OFF"] += duration
            outage_count += 1

    now = datetime.now()
    days_passed = (now - start_date).days if now < end_date else (end_date - start_date).days
    days_passed = max(days_passed, 1)

    avg_grid = stats.get("NEPA", 0) / days_passed
    freq = outage_count / days_passed
    total_time = sum(stats.values())
    uptime = ((stats.get("NEPA", 0) + stats.get("GEN", 0)) / total_time * 100) if total_time > 0 else 0

    return {
        "avg_grid": f"{round(avg_grid, 1)}h",
        "frequency": f"{round(freq, 1)}/day",
        "uptime": f"{round(uptime)}%"
    }

@app.get("/api/logs/all")
def get_all_logs(page: int = 1, limit: int = 50, db: Session = Depends(get_db)):
    page = max(1, page)
    limit = max(1, min(100, limit)) # Cap maximum limit to prevent memory exhaust
    offset = (page - 1) * limit
    logs = db.query(PowerLog).order_by(PowerLog.timestamp.desc(), PowerLog.id.desc()).offset(offset).limit(limit).all()
    total = db.query(PowerLog).count()
    return {"logs": logs, "total": total}

@app.get("/api/logs/export")
def export_logs_csv(db: Session = Depends(get_db)):
    logs_query = db.query(PowerLog).order_by(PowerLog.timestamp.asc(), PowerLog.id.asc()).yield_per(1000)
    return StreamingResponse(
        generate_nepa_csv_stream(logs_query),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=nepa_archive_export.csv"}
    )

# --- MANUAL OVERRIDE ENDPOINTS (SECURED) ---
@app.post("/api/logs/manual", dependencies=[Depends(verify_admin)])
def add_manual_log(data: LogEntry, db: Session = Depends(get_db)):
    new_log = PowerLog(event=data.event, source=data.source, timestamp=data.timestamp)
    db.add(new_log)
    db.commit()
    return {"message": "Log added manually"}

@app.put("/api/logs/{log_id}", dependencies=[Depends(verify_admin)])
def edit_log(log_id: int, data: LogEntry, db: Session = Depends(get_db)):
    log = db.query(PowerLog).filter(PowerLog.id == log_id).first()
    if not log: raise HTTPException(status_code=404, detail="Log not found")
    
    log.event = data.event
    log.source = data.source if data.event == "ON" else None
    log.timestamp = data.timestamp
    db.commit()
    return {"message": "Log updated successfully"}

@app.delete("/api/logs/{log_id}", dependencies=[Depends(verify_admin)])
def delete_log(log_id: int, db: Session = Depends(get_db)):
    log = db.query(PowerLog).filter(PowerLog.id == log_id).first()
    if not log: raise HTTPException(status_code=404, detail="Log not found")
    
    db.delete(log)
    db.commit()
    return {"message": "Log deleted"}

@app.post("/api/logs/bulk-delete", dependencies=[Depends(verify_admin)])
def bulk_delete_logs(data: BulkDelete, db: Session = Depends(get_db)):
    # synchronize_session=False ensures max efficiency when deleting bulk rows directly in SQL
    db.query(PowerLog).filter(PowerLog.id.in_(data.log_ids)).delete(synchronize_session=False)
    db.commit()
    return {"message": f"{len(data.log_ids)} logs deleted"}