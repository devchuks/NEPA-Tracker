import os
from fastapi import FastAPI, Depends, BackgroundTasks
from sqlalchemy import create_engine, Column, Integer, DateTime, String, Boolean
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from datetime import datetime, timedelta
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
import calendar
from calendar import monthrange
import io
import csv

from telegram_service import send_telegram_alert
from export_service import generate_nepa_csv

# --- DATABASE SETUP ---
# Uses live PostgreSQL if available, falls back to local SQLite
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
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",               # Keeps your local testing working
        "https://nepa-tracker.netlify.app"     # Allows your live Netlify frontend
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_db():
    db = SessionLocal()
    try: yield db
    finally: db.close()

# --- PYDANTIC SCHEMAS ---
class SourceToggle(BaseModel):
    source: str

class LogEntry(BaseModel):
    event: str
    source: Optional[str] = None
    timestamp: datetime

# --- ENDPOINTS ---

@app.post("/api/source")
def toggle_source(data: SourceToggle, db: Session = Depends(get_db)):
    status = db.query(PowerStatus).filter(PowerStatus.id == 1).first()
    if status:
        status.source = data.source
        
    last_log = db.query(PowerLog).order_by(PowerLog.timestamp.desc()).first()
    
    if last_log and last_log.event == "ON":
        last_log.source = data.source
        
    db.commit()
    return {"message": "Source updated", "source": data.source}

@app.post("/api/ping")
def receive_ping(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    status = db.query(PowerStatus).filter(PowerStatus.id == 1).first()
    now = datetime.now()
    
    if not status:
        status = PowerStatus(id=1, last_ping=now, is_online=True, source="NEPA")
        db.add(status)
        db.add(PowerLog(event="ON", source="NEPA", timestamp=now))
        background_tasks.add_task(send_telegram_alert, "⚡ Power restored via NEPA!")
    else:
        time_since_last_ping = (now - status.last_ping).total_seconds()
        
        # TIMING FIX: 65 Second Dead Man's Switch
        if time_since_last_ping > 65 and status.is_online:
            death_time = status.last_ping + timedelta(seconds=65)
            db.add(PowerLog(event="OFF", source=None, timestamp=death_time))
            db.add(PowerLog(event="ON", source=status.source, timestamp=now))
            background_tasks.add_task(send_telegram_alert, f"⚡ Power restored via {status.source}!")
            status.is_online = True
            
        elif not status.is_online:
            db.add(PowerLog(event="ON", source=status.source, timestamp=now))
            background_tasks.add_task(send_telegram_alert, f"⚡ Power restored via {status.source}!")
            status.is_online = True
            
        status.last_ping = now
    
    db.commit()
    return {"message": "Success"}

@app.get("/api/status")
def get_status(background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    status = db.query(PowerStatus).filter(PowerStatus.id == 1).first()
    if not status: return {"nepa": "OFF", "source": "NEPA"}
    
    now = datetime.now()
    diff = now - status.last_ping
    
    # TIMING FIX: 65 Second Dead Man's Switch
    if diff > timedelta(seconds=65):
        if status.is_online: 
            status.is_online = False
            
            # THE FIX: Calculate the exact time it died based on the last successful ping
            death_time = status.last_ping + timedelta(seconds=65)
            
            # Log the outage using the death_time, NOT datetime.now()
            db.add(PowerLog(event="OFF", source=None, timestamp=death_time))
            db.commit()
            
            background_tasks.add_task(send_telegram_alert, "⚠️ ALERT: Power has been lost!")
            
        return {"nepa": "OFF", "source": status.source}

@app.get("/api/logs")
def get_logs(db: Session = Depends(get_db)):
    logs = db.query(PowerLog).order_by(PowerLog.timestamp.desc(), PowerLog.id.desc()).limit(8).all()
    return logs

@app.get("/api/analytics/master")
def get_master_analytics(date: str, timeframe: str = "day", db: Session = Depends(get_db)):
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
        
    initial_log = db.query(PowerLog).filter(PowerLog.timestamp <= start_dt).order_by(PowerLog.timestamp.desc()).first()
    logs = db.query(PowerLog).filter(PowerLog.timestamp >= start_dt, PowerLog.timestamp < math_end_dt).order_by(PowerLog.timestamp.asc()).all()
    
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
            if curr.event == "ON": stats[curr.source] += dur
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

        for i in range(len(timeline) - 1):
            curr, nxt = timeline[i], timeline[i+1]
            if curr.event == "ON":
                ev_start = curr.timestamp
                ev_end = nxt.timestamp
                stats[curr.source] += (ev_end - ev_start).total_seconds() / 3600
                
                for b in buckets:
                    overlap_start = max(ev_start, b["start"])
                    overlap_end = min(ev_end, b["end"])
                    if overlap_start < overlap_end:
                        dur = (overlap_end - overlap_start).total_seconds() / 3600
                        if curr.source == "NEPA": b["Grid"] += dur
                        elif curr.source == "GEN": b["Gen"] += dur
            else:
                stats["OFF"] += (nxt.timestamp - curr.timestamp).total_seconds() / 3600

        for b in buckets:
            trend.append({
                "name": b["name"],
                "Grid": round(b["Grid"], 1),
                "Gen": round(b["Gen"], 1)
            })

    total_hours = sum(stats.values())
    uptime_pct = round(((stats["NEPA"] + stats["GEN"]) / total_hours) * 100) if total_hours > 0 else 0
    
    return {
        "trend": trend,
        "distribution": [
            {"name": "Grid", "value": round(stats["NEPA"], 1), "color": "#ec4899"},
            {"name": "Gen", "value": round(stats["GEN"], 1), "color": "#f59e0b"},
            {"name": "Off", "value": round(stats["OFF"], 1), "color": "#94a3b8"}
        ],
        "kpis": {
            "uptime": f"{uptime_pct}%",
            "grid_hours": f"{round(stats['NEPA'], 1)}h",
            "outages": len([l for l in logs if l.event == "OFF" and l.timestamp >= start_dt and l.timestamp < math_end_dt])
        }
    }

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
    ).order_by(PowerLog.timestamp.asc()).all()

    if not logs:
        return {"avg_grid": "0h", "frequency": "0/day", "uptime": "0%"}

    stats = {"NEPA": 0, "GEN": 0, "OFF": 0}
    outage_count = 0
    
    for i in range(len(logs) - 1):
        curr, nxt = logs[i], logs[i+1]
        duration = (nxt.timestamp - curr.timestamp).total_seconds() / 3600
        if curr.event == "ON":
            stats[curr.source] += duration
        else:
            stats["OFF"] += duration
            outage_count += 1

    now = datetime.now()
    days_passed = (now - start_date).days if now < end_date else (end_date - start_date).days
    days_passed = max(days_passed, 1)

    avg_grid = stats["NEPA"] / days_passed
    freq = outage_count / days_passed
    total_time = sum(stats.values())
    uptime = ((stats["NEPA"] + stats["GEN"]) / total_time * 100) if total_time > 0 else 0

    return {
        "avg_grid": f"{round(avg_grid, 1)}h",
        "frequency": f"{round(freq, 1)}/day",
        "uptime": f"{round(uptime)}%"
    }

@app.get("/api/analytics/streak")
def get_longest_streak(db: Session = Depends(get_db)):
    try:
        logs = db.query(PowerLog).order_by(PowerLog.timestamp.asc()).all()
        if not logs: return {"hours": "0", "start": "---", "end": "---"}

        max_duration = 0
        current_start = None
        best_start = None
        best_end = None
        
        for log in logs:
            if log.event == "ON" and log.source == "NEPA":
                if current_start is None:
                    current_start = log.timestamp
            else:
                if current_start is not None:
                    duration = (log.timestamp - current_start).total_seconds()
                    if duration > max_duration:
                        max_duration = duration
                        best_start = current_start
                        best_end = log.timestamp
                    current_start = None
                    
        if current_start is not None:
            now = datetime.now()
            duration = (now - current_start).total_seconds()
            if duration > max_duration:
                max_duration = duration
                best_start = current_start
                best_end = now
                
        if max_duration == 0: return {"hours": "0", "start": "---", "end": "---"}
            
        hours = max_duration / 3600
        start_str = best_start.strftime("%b %d, %H:%M") if best_start else "---"
        end_str = best_end.strftime("%b %d, %H:%M") if best_end else "---"
        return {"hours": f"{round(hours, 1)}", "start": start_str, "end": end_str}
    except Exception as e:
        return {"hours": "Error", "start": "---", "end": "---"}

@app.get("/api/logs/all")
def get_all_logs(page: int = 1, limit: int = 50, db: Session = Depends(get_db)):
    offset = (page - 1) * limit
    logs = db.query(PowerLog).order_by(PowerLog.timestamp.desc()).offset(offset).limit(limit).all()
    total = db.query(PowerLog).count()
    return {"logs": logs, "total": total}

@app.get("/api/logs/export")
def export_logs_csv(db: Session = Depends(get_db)):
    logs = db.query(PowerLog).order_by(PowerLog.timestamp.asc()).all()
    csv_data = generate_nepa_csv(logs)
    return StreamingResponse(
        iter([csv_data]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=nepa_archive_export.csv"}
    )

# --- MANUAL OVERRIDE (CRUD) ENDPOINTS ---

@app.post("/api/logs/manual")
def add_manual_log(data: LogEntry, db: Session = Depends(get_db)):
    new_log = PowerLog(event=data.event, source=data.source, timestamp=data.timestamp)
    db.add(new_log)
    db.commit()
    return {"message": "Log added manually"}

@app.put("/api/logs/{log_id}")
def edit_log(log_id: int, data: LogEntry, db: Session = Depends(get_db)):
    log = db.query(PowerLog).filter(PowerLog.id == log_id).first()
    if not log:
        return {"error": "Log not found"}
    
    log.event = data.event
    log.source = data.source if data.event == "ON" else None
    log.timestamp = data.timestamp
    db.commit()
    return {"message": "Log updated successfully"}

@app.delete("/api/logs/{log_id}")
def delete_log(log_id: int, db: Session = Depends(get_db)):
    log = db.query(PowerLog).filter(PowerLog.id == log_id).first()
    if not log:
        return {"error": "Log not found"}
    
    db.delete(log)
    db.commit()
    return {"message": "Log deleted"}