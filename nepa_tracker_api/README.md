# ⚡ NEPA Tracker - Backend API

This directory contains the FastAPI backend for the NepaTracker system. It is responsible for listening to hardware telemetry, managing the database, calculating outage durations, and triggering real-time alerts.

## 📂 Project Structure

### `main.py`
The core FastAPI application. This file houses the API endpoints, including the primary `/api/ping` route that acts as the "Dead Man's Switch." It listens for the 60-second hardware heartbeats and executes the core logic to determine if power has been lost or restored.

### `telegram_service.py`
The alerting engine. This module securely loads environment variables (`TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`) and communicates with the Telegram Bot API. It pushes instant notifications to your phone whenever `main.py` detects a state change (e.g., Power Outage or Power Restored).

### `export_service.py`
A custom data extraction utility designed for heavy analytics. Instead of just dumping raw database rows, this service constructs a highly formatted CSV on the fly. 
* **Dynamic Durations:** It calculates the exact duration of every power event in both minutes and hours by comparing current and subsequent timestamps.
* **Pivot-Table Ready:** It automatically splits timestamps into explicit `Year`, `Month`, `Day`, and `Day_of_Week` columns, making the data instantly ready for spreadsheet analysis or external BI tools.

### `seed_data.py`
A standalone data-generation tool. This script connects to a local SQLite database and generates years of simulated, alternating power logs (ON/OFF). It uses randomized weights (e.g., 75% chance of NEPA, 25% chance of GEN) and realistic duration windows to populate the database with enough mock data to stress-test the UI's long-term analytics and heatmaps. 

### `requirements.txt`
The Python dependencies required to run the server (e.g., `fastapi`, `uvicorn`, `requests`, `python-dotenv`).
