#!/usr/bin/env python3
"""
NimeStream Registration Bot
Requirements: pip install pyTelegramBotAPI requests
Run: python3 telegram-bot.py
"""

import telebot
import requests
import re
import time
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s')

# ============================================================
# KONFIGURASI — GANTI SESUAI MILIKMU
# ============================================================
BOT_TOKEN    = "8561286518:AAHQ74xMSn7weml37dyzfv_7zc-5gebalYc"          # @BotFather → /newbot
SUPABASE_URL = "https://panhgnyfszfxoaiuavzz.supabase.co"        # Project URL
SERVICE_KEY  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhbmhnbnlmc3pmeG9haXVhdnp6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUxODQzOCwiZXhwIjoyMDkwMDk0NDM4fQ.VD2HH7DUnIuLbEtugpHIl5WaicU5oHaCHxUG86o2oVA"  # Settings → API → service_role
WEBSITE_URL  = "https://kiz-stream.vercel.app"
# ============================================================

bot = telebot.TeleBot(BOT_TOKEN, parse_mode='Markdown')
states = {}   # { chat_id: { step, username, email } }

HEADERS_ADMIN = {
    'apikey': SERVICE_KEY,
    'Authorization': f'Bearer {SERVICE_KEY}',
    'Content-Type': 'application/json'
}

def ok_username(u): return bool(re.match(r'^[a-zA-Z0-9_]{3,20}$', u))
def ok_email(e):    return bool(re.match(r'^[^@\s]+@[^@\s]+\.[^@\s]+$', e))
def ok_pass(p):     return len(p) >= 6

def check_username_taken(username: str) -> bool:
    r = requests.get(
        f"{SUPABASE_URL}/rest/v1/profiles?username=eq.{username}&select=username",
        headers=HEADERS_ADMIN, timeout=10
    )
    return r.ok and len(r.json()) > 0

def create_user(email, password, username, tg_id) -> dict:
    r = requests.post(
        f"{SUPABASE_URL}/auth/v1/admin/users",
        headers=HEADERS_ADMIN,
        json={
            'email': email, 'password': password,
            'email_confirm': True,
            'user_metadata': {'username': username, 'telegram_id': tg_id}
        }, timeout=15
    )
    if r.status_code not in (200, 201):
        data = r.json()
        return {'ok': False, 'err': data.get('msg') or data.get('message') or 'Gagal'}
    uid = r.json().get('id','')
    # Patch profile
    requests.patch(
        f"{SUPABASE_URL}/rest/v1/profiles?id=eq.{uid}",
        headers={**HEADERS_ADMIN, 'Prefer': 'return=minimal'},
        json={'telegram_id': tg_id, 'username': username},
        timeout=10
    )
    return {'ok': True, 'uid': uid}

# ─── HANDLERS ───────────────────────────────────────────────

@bot.message_handler(commands=['start'])
def h_start(msg):
    bot.send_message(msg.chat.id,
        "⚡ *Selamat datang di NimeStream Bot!*\n\n"
        "Bot ini untuk membuat akun agar kamu bisa nonton anime, simpan riwayat, dan komen.\n\n"
        "📋 *Perintah:*\n"
        "• /daftar — Buat akun baru\n"
        "• /login\_info — Cara login di website\n"
        "• /batal — Batalkan proses\n\n"
        f"🌐 {WEBSITE_URL}"
    )

@bot.message_handler(commands=['login_info', 'login'])
def h_login(msg):
    bot.send_message(msg.chat.id,
        "🔐 *Cara Login:*\n\n"
        f"1. Buka {WEBSITE_URL}\n"
        "2. Tap ikon 👤 di navbar\n"
        "3. Pilih *Login*\n"
        "4. Masukkan email & password\n"
        "5. Tap *Masuk*\n\n"
        "Belum punya akun? Ketik /daftar"
    )

@bot.message_handler(commands=['batal'])
def h_batal(msg):
    states.pop(msg.chat.id, None)
    bot.send_message(msg.chat.id, "❌ Dibatalkan.")

@bot.message_handler(commands=['daftar'])
def h_daftar(msg):
    states[msg.chat.id] = {'step': 'username'}
    bot.send_message(msg.chat.id,
        "📝 *Daftar Akun NimeStream* — Langkah 1/3\n\n"
        "Masukkan *username* yang diinginkan:\n"
        "_(3–20 karakter, hanya huruf/angka/underscore)_"
    )

@bot.message_handler(func=lambda m: True, content_types=['text'])
def h_text(msg):
    cid  = msg.chat.id
    text = msg.text.strip()

    if cid not in states:
        bot.send_message(cid, "Ketik /daftar untuk membuat akun atau /start untuk info.")
        return

    s = states[cid]

    # ── STEP 1: USERNAME
    if s['step'] == 'username':
        if not ok_username(text):
            bot.send_message(cid,
                "❌ Username tidak valid!\n"
                "_Gunakan 3–20 karakter: huruf, angka, atau underscore._\n\nCoba lagi:"
            ); return
        if check_username_taken(text):
            bot.send_message(cid, f"❌ Username `{text}` sudah dipakai. Coba nama lain:"); return
        s['username'] = text; s['step'] = 'email'
        bot.send_message(cid,
            f"✅ Username: *{text}*\n\n"
            "Langkah 2/3 — Masukkan *email* kamu:"
        )

    # ── STEP 2: EMAIL
    elif s['step'] == 'email':
        if not ok_email(text):
            bot.send_message(cid, "❌ Format email tidak valid.\nContoh: nama@gmail.com\n\nCoba lagi:"); return
        s['email'] = text; s['step'] = 'password'
        bot.send_message(cid,
            f"✅ Email: *{text}*\n\n"
            "Langkah 3/3 — Buat *password*:\n"
            "_(minimal 6 karakter, jaga kerahasiaannya!)_"
        )

    # ── STEP 3: PASSWORD
    elif s['step'] == 'password':
        if not ok_pass(text):
            bot.send_message(cid, "❌ Password minimal 6 karakter.\n\nCoba lagi:"); return

        bot.send_message(cid, "⏳ Sedang membuat akun...")
        result = create_user(
            email=s['email'], password=text,
            username=s['username'], tg_id=cid
        )
        states.pop(cid, None)

        if result['ok']:
            bot.send_message(cid,
                "🎉 *Akun berhasil dibuat!*\n\n"
                f"👤 Username : *{s['username']}*\n"
                f"📧 Email    : *{s['email']}*\n\n"
                f"➡️ Sekarang login di:\n{WEBSITE_URL}\n\n"
                "Gunakan email & password yang baru saja dibuat.\n"
                "_Selamat menonton! ⚡_"
            )
        else:
            bot.send_message(cid,
                f"❌ *Gagal membuat akun*\n\nAlasan: _{result['err']}_\n\n"
                "Coba lagi dengan /daftar"
            )

if __name__ == '__main__':
    logging.info(f"Bot aktif | Website: {WEBSITE_URL}")
    while True:
        try:
            bot.infinity_polling(timeout=20, long_polling_timeout=10)
        except Exception as e:
            logging.error(f"Polling error: {e}")
            time.sleep(5)
