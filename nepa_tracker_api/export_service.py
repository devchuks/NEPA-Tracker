import io
import csv
from datetime import datetime

def generate_nepa_csv_stream(logs_iterable):
    output = io.StringIO()
    writer = csv.writer(output)
    
    writer.writerow([
        "ID", "Event", "Source", 
        "Start_Date", "Start_Time", 
        "End_Date", "End_Time", 
        "Duration_Minutes", "Duration_Hours", 
        "Year", "Month", "Day", "Day_of_Week", 
        "Unix_Timestamp"
    ])
    yield output.getvalue()
    output.seek(0)
    output.truncate(0)
    
    prev_log = None
    
    for log in logs_iterable:
        if prev_log is not None:
            duration_secs = (log.timestamp - prev_log.timestamp).total_seconds()
            duration_mins = round(duration_secs / 60, 1)
            duration_hrs = round(duration_secs / 3600, 2)
            
            writer.writerow([
                prev_log.id, prev_log.event, prev_log.source or "OFFLINE", 
                prev_log.timestamp.strftime("%Y-%m-%d"), prev_log.timestamp.strftime("%H:%M:%S"), 
                log.timestamp.strftime("%Y-%m-%d"), log.timestamp.strftime("%H:%M:%S"), 
                duration_mins, duration_hrs, 
                prev_log.timestamp.year, prev_log.timestamp.month, prev_log.timestamp.day, prev_log.timestamp.strftime("%A"), 
                int(prev_log.timestamp.timestamp())
            ])
            yield output.getvalue()
            output.seek(0)
            output.truncate(0)
            
        prev_log = log
        
    if prev_log is not None:
        now = datetime.now()
        duration_secs = (now - prev_log.timestamp).total_seconds()
        writer.writerow([
            prev_log.id, prev_log.event, prev_log.source or "OFFLINE", 
            prev_log.timestamp.strftime("%Y-%m-%d"), prev_log.timestamp.strftime("%H:%M:%S"), 
            "Ongoing", "Ongoing", 
            round(duration_secs / 60, 1), round(duration_secs / 3600, 2), 
            prev_log.timestamp.year, prev_log.timestamp.month, prev_log.timestamp.day, prev_log.timestamp.strftime("%A"), 
            int(prev_log.timestamp.timestamp())
        ])
        yield output.getvalue()