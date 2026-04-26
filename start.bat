@echo off
echo Starting NepaTracker Development Servers...

:: Start the Python FastAPI Backend in a new window
start "NepaTracker API" cmd /k "cd nepa_tracker_api && venv\Scripts\activate && uvicorn main:app --reload"

:: Start the React Vite Frontend in a new window
start "NepaTracker Web" cmd /k "cd nepa_tracker_web && npm run dev"

echo Both servers are spinning up in separate windows!