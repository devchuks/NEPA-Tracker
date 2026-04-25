import sqlite3
from datetime import datetime, timedelta
import random

def seed_database():
    conn = sqlite3.connect('nepa.db')
    cursor = conn.cursor()

    # Clear old data to prevent overlapping timelines
    cursor.execute("DELETE FROM power_logs")
    
    # 2 Years back from today (March 2024 to March 2026)
    start_date = datetime(2016, 1, 10, 0, 0, 0)
    end_date = datetime(2026, 3, 19, 23, 59, 59)
    current_time = start_date

    print(f"Generating years of history from {start_date.strftime('%Y-%m-%d')} to {end_date.strftime('%Y-%m-%d')}...")

    # STRICT STATE TRACKER: Power must strictly alternate ON -> OFF -> ON
    next_event = "ON"
    logs = []

    while current_time < end_date:
        if next_event == "ON":
            # 75% chance NEPA comes back, 25% chance you turn on the GEN
            source = random.choices(["NEPA", "GEN"], weights=[0.5, 0.5])[0]
            logs.append(("ON", source, current_time.strftime("%Y-%m-%d %H:%M:%S")))
            
            # Realistic durations: NEPA usually stays on longer than you'd run a GEN
            if source == "NEPA":
                duration = timedelta(hours=random.uniform(2.0, 14.0)) # NEPA lasts 2 to 16 hours
            else:
                duration = timedelta(hours=random.uniform(1.0, 9.0))  # GEN runs 1 to 4.5 hours
                
            next_event = "OFF"
            
        else:
            # Power goes out
            logs.append(("OFF", None, current_time.strftime("%Y-%m-%d %H:%M:%S")))
            
            # Realistic outage: 30 minutes to 8 hours
            duration = timedelta(hours=random.uniform(0.5, 8.0)) 
            
            next_event = "ON"

        # Advance the clock by the duration of the event
        current_time += duration

    # We use executemany instead of a loop for massive performance gains on 2 years of data
    cursor.executemany(
        "INSERT INTO power_logs (event, source, timestamp) VALUES (?, ?, ?)",
        logs
    )

    conn.commit()
    conn.close()
    print(f"✅ Successfully seeded {len(logs)} perfectly alternating records!")

if __name__ == "__main__":
    seed_database()