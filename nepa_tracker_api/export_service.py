import io
import csv
from datetime import datetime

def generate_nepa_csv(logs):
    output = io.StringIO()
    writer = csv.writer(output)
    
    # The ultimate import-friendly header row
    writer.writerow([
        "ID", "Event", "Source", 
        "Start_Date", "Start_Time", 
        "End_Date", "End_Time", 
        "Duration_Minutes", "Duration_Hours", 
        "Year", "Month", "Day", "Day_of_Week", 
        "Unix_Timestamp"
    ])
    
    for i in range(len(logs)):
        log = logs[i]
        
        # 1. Calculate End Times & Durations by looking at the NEXT event
        duration_mins = 0
        duration_hrs = 0
        end_date_str = ""
        end_time_str = ""
        
        if i < len(logs) - 1:
            next_log = logs[i+1]
            duration_secs = (next_log.timestamp - log.timestamp).total_seconds()
            duration_mins = round(duration_secs / 60, 1)
            duration_hrs = round(duration_secs / 3600, 2)
            end_date_str = next_log.timestamp.strftime("%Y-%m-%d")
            end_time_str = next_log.timestamp.strftime("%H:%M:%S")
        else:
            # The very last log in the database is currently "Ongoing"
            now = datetime.now()
            duration_secs = (now - log.timestamp).total_seconds()
            duration_mins = round(duration_secs / 60, 1)
            duration_hrs = round(duration_secs / 3600, 2)
            end_date_str = "Ongoing"
            end_time_str = "Ongoing"
            
        # 2. Extract explicit date parts for easy pivot tables
        start_date_str = log.timestamp.strftime("%Y-%m-%d")
        start_time_str = log.timestamp.strftime("%H:%M:%S")
        year = log.timestamp.year
        month = log.timestamp.month
        day = log.timestamp.day
        day_of_week = log.timestamp.strftime("%A")
        
        # 3. Get Unix Timestamp for flawless database imports
        unix_ts = int(log.timestamp.timestamp())
        
        writer.writerow([
            log.id, 
            log.event, 
            log.source or "OFFLINE", 
            start_date_str, 
            start_time_str, 
            end_date_str, 
            end_time_str, 
            duration_mins, 
            duration_hrs, 
            year, 
            month, 
            day, 
            day_of_week, 
            unix_ts
        ])
    
    output.seek(0)
    return output.getvalue()