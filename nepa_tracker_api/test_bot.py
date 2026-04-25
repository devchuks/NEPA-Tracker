import requests

TOKEN = "8763885815:AAEeFsESaFY8PKwZqzUu14rNodwtUKUVoIk"
CHAT_ID = "1225635624"
MESSAGE = "Testing! If you see this, the credentials work!"

url = f"https://api.telegram.org/bot{TOKEN}/sendMessage"
response = requests.post(url, json={"chat_id": CHAT_ID, "text": MESSAGE})

print("Status Code:", response.status_code)
print("Response:", response.text)