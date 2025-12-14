import os
import redis
import json
import time
import requests
from google import genai

# Configuration
REDIS_HOST = os.getenv('REDIS_HOST', 'localhost')
REDIS_PORT = int(os.getenv('REDIS_PORT', 6379))
REDIS_DB = int(os.getenv('REDIS_DB', 0))
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')
GEMINI_MODEL = os.getenv('GEMINI_MODEL', 'gemini-2.5-flash')
DISCORD_WEBHOOK_URL = os.getenv('DISCORD_WEBHOOK_URL')

if GEMINI_API_KEY:
    client = genai.Client(api_key=GEMINI_API_KEY)
else:
    client = None

def get_ai_response(prompt):
    if not client:
        print("Creating mock AI response (No Gemini API Key)", flush=True)
        return f"[MOCK AI RESPONSE] Content for: {prompt[:50]}..."

    try:
        resp = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt
        )
        return resp.text
    except Exception as e:
        print(f"Error calling Gemini: {e}", flush=True)
        return "[Error generating AI content]"

def send_discord_notification(content):
    if not DISCORD_WEBHOOK_URL:
        print("No Discord Webhook URL configured. Skipping.", flush=True)
        return

    try:
        requests.post(DISCORD_WEBHOOK_URL, json={"content": content})
        print("Sent to Discord.", flush=True)
    except Exception as e:
        print(f"Error sending to Discord: {e}", flush=True)

def process_auction(auction_data):
    print(f"Processing finished auction: {auction_data['id']}", flush=True)

    item_name = auction_data.get('title')
    final_price = auction_data.get('current_price')
    winner = auction_data.get('highest_bidder') or "Ninguém"

    # 1. Generate Report
    prompt_report = f"Baseado no resultado do leilão, gere um resumo bem completo do leilão, destacando o item {item_name}, valor final {final_price} e vencedor {winner}."
    report = get_ai_response(prompt_report)
    print("--- RELATÓRIO ---", flush=True)
    print(report, flush=True)

    # 2. Generate Email
    if winner != "Ninguém":
        prompt_email = f"Escreva um e-mail amigável parabenizando {winner} pela vitória no leilão do item {item_name} pelo valor de {final_price}. Informe os próximos passos para pagamento."
        email_content = get_ai_response(prompt_email)
        print("--- EMAIL PARA VENCEDOR ---", flush=True)
        print(email_content, flush=True)
        # In a real app, we would send the email here using SMTP

    # 3. Discord Post
    prompt_discord = f"Crie um post no canal de Discord #geral anunciando que o item {item_name} foi arrematado por {final_price} pelo vencedor {winner}!"
    discord_content = get_ai_response(prompt_discord)
    print("--- POST DISCORD ---", flush=True)
    print(discord_content, flush=True)

    send_discord_notification(discord_content)

def main():
    print("Worker started. Waiting for finished auctions...", flush=True)
    r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, db=REDIS_DB, decode_responses=True)
    p = r.pubsub()
    p.subscribe('leiloes_finalizados')

    for message in p.listen():
        if message['type'] == 'message':
            try:
                data = json.loads(message['data'])
                process_auction(data)
            except Exception as e:
                print(f"Error processing message: {e}", flush=True)

if __name__ == "__main__":
    main()

