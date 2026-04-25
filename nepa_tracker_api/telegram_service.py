import os
import requests
from dotenv import load_dotenv

# This forces Python to actively read the .env file
load_dotenv()

# --- SECURE TELEGRAM CONFIGURATION ---
# These pull from your local .env file or your Render Environment Variables
TELEGRAM_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")

def send_telegram_alert(message: str):
    # Quick safety check: If the keys are missing, print an error instead of crashing
    if not TELEGRAM_TOKEN or not TELEGRAM_CHAT_ID:
        print("❌ Telegram credentials missing! Check your .env file or Render settings.")
        return

    url = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage"
    payload = {"chat_id": TELEGRAM_CHAT_ID, "text": message}
    
    try:
        response = requests.post(url, json=payload, timeout=5)
        response.raise_for_status()  
    except Exception as e:
        print(f"❌ Failed to send Telegram alert: {e}")