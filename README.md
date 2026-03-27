# ⚡ NimeStream v12

Web App streaming anime HD sub indo. PWA — bisa diinstall di HP seperti aplikasi native.

---

## 🗂️ Struktur Project

```
animenew/
├── api/
│   └── index.js          ← Backend Express.js (Vercel Serverless)
├── public/
│   ├── index.html        ← Halaman utama
│   ├── app.js            ← Logika frontend
│   ├── style.css         ← Tampilan
│   ├── sw.js             ← Service Worker (PWA)
│   └── manifest.json     ← PWA manifest
├── vercel.json           ← Konfigurasi Vercel
├── package.json          ← Dependencies
├── supabase-schema.sql   ← Schema database
└── telegram-bot.py       ← Bot registrasi Telegram
```

---

## 🚀 Deploy ke Vercel (5 menit)

### 1. Push ke GitHub
```bash
git init
git add .
git commit -m "NimeStream v12"
git remote add origin https://github.com/USERNAME/nimestream.git
git push -u origin main
```

### 2. Deploy di Vercel
1. Buka https://vercel.com → **Add New Project**
2. Import repository GitHub kamu
3. **Framework Preset**: Other
4. **Root Directory**: `.` (biarkan default)
5. Klik **Deploy**

> ✅ Vercel otomatis mendeteksi `vercel.json` dan `api/index.js`

### 3. Verifikasi API
Setelah deploy, test endpoint:
```
https://NAMA-PROJECT.vercel.app/api/health
https://NAMA-PROJECT.vercel.app/api/latest
https://NAMA-PROJECT.vercel.app/api/jadwal
```

---

## 🛢️ Setup Supabase (untuk Login & Komentar)

### 1. Buat Project
- Buka https://supabase.com → **New Project**
- Isi nama, password database, pilih region **Southeast Asia (Singapore)**

### 2. Jalankan Schema
- Supabase Dashboard → **SQL Editor** → **New Query**
- Copy-paste seluruh isi `supabase-schema.sql`
- Klik **Run**

### 3. Aktifkan Realtime
- Supabase Dashboard → **Database** → **Replication**
- Pastikan tabel `comments` sudah muncul di bagian Source

### 4. Ambil Credentials
- Supabase Dashboard → **Settings** → **API**
- Copy **Project URL** dan **anon public** key

### 5. Isi di app.js
```javascript
const SB_URL = 'https://XXXXXXXXXXXX.supabase.co';  // Project URL
const SB_KEY = 'eyJhbGci...';                        // anon public key
```

### 6. Setup Auth
- Supabase Dashboard → **Authentication** → **Settings**
- **Site URL**: `https://NAMA-PROJECT.vercel.app`
- **Email confirm**: Nonaktifkan (supaya user dari bot Telegram langsung bisa login)

---

## 🤖 Setup Bot Telegram

### 1. Buat Bot
- Buka Telegram → cari **@BotFather**
- Ketik `/newbot` → ikuti instruksi
- Copy **token**

### 2. Ambil Service Role Key
- Supabase Dashboard → **Settings** → **API** → **service_role** key
- ⚠️ Jangan expose key ini di frontend! Hanya untuk bot server-side.

### 3. Isi Konfigurasi telegram-bot.py
```python
BOT_TOKEN    = "1234567890:AAHxxx..."  # Token dari BotFather
SUPABASE_URL = "https://xxx.supabase.co"
SERVICE_KEY  = "eyJhbGci..."           # service_role key
WEBSITE_URL  = "https://nimestream.vercel.app"
```

### 4. Install & Jalankan
```bash
pip install pyTelegramBotAPI requests
python3 telegram-bot.py
```

### 5. Jalankan Permanen (VPS)
```bash
# Install tmux
sudo apt install tmux

# Buka session baru
tmux new -s nimebot

# Jalankan bot
python3 telegram-bot.py

# Detach: Ctrl+B lalu D
# Attach lagi: tmux attach -t nimebot
```

---

## 💰 Setup Google AdSense

### 1. Daftar AdSense
- Buka https://adsense.google.com → daftarkan website kamu

### 2. Aktifkan di index.html
```html
<!-- Uncomment baris ini di index.html -->
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-XXXXX" crossorigin="anonymous"></script>
```

### 3. Isi Publisher ID di app.js & index.html
Ganti semua `ca-pub-XXXXXXXXXXXXXXXX` dengan Publisher ID milikmu.

### 4. Ganti Ad Slot
Ganti `data-ad-slot="XXXXXXXXXX"` dengan Ad Unit ID dari AdSense dashboard.

---

## 🔧 Konfigurasi Lanjutan

### Ganti Logo
Ganti file `public/295a6dc7f4efe03269d55d35a91668d3.jpg` dengan logo kamu.

### Ganti Domain Bot Telegram di Login Modal
Di `app.js`, cari `@NimeStreamBot` dan ganti dengan username bot kamu.

### Custom Domain di Vercel
- Vercel Dashboard → Project → **Settings** → **Domains**
- Tambahkan domain kamu

---

## 🐛 Troubleshooting

| Masalah | Solusi |
|---|---|
| Episode tidak bisa diputar | Cek `/api/debug?url=URL_EPISODE` |
| Stream error | Proxy mungkin diblok, tunggu beberapa menit |
| Login gagal | Pastikan SB_URL dan SB_KEY sudah benar |
| Jadwal kosong | AniList mungkin down, coba reload |
| Bot Telegram error 401 | BOT_TOKEN salah atau expired |
| Bot Telegram tidak merespons | Cek log: `python3 telegram-bot.py` |

---

## 📊 API Endpoints

| Method | Endpoint | Keterangan |
|---|---|---|
| GET | `/api/latest?page=1` | Anime terbaru |
| GET | `/api/search?q=naruto` | Cari anime |
| GET | `/api/detail?url=URL` | Detail anime |
| GET | `/api/watch?url=URL` | Stream links |
| GET | `/api/jadwal` | Jadwal tayang (WIB) |
| GET | `/api/random` | Anime acak |
| GET | `/api/genres` | Daftar genre |
| GET | `/api/health` | Health check |
| GET | `/api/cache-stats` | Status cache |
| GET | `/api/debug?url=URL` | Debug stream |

---

## 📱 Fitur Lengkap

- ✅ Streaming anime dari Samehadaku
- ✅ Jadwal tayang real-time (AniList, jam WIB)
- ✅ Riwayat menonton dengan progress bar
- ✅ Favorit anime
- ✅ Komentar real-time (Supabase)
- ✅ Login email/password (via bot Telegram)
- ✅ Dark/Light mode
- ✅ PWA — installable di HP
- ✅ Offline indicator
- ✅ Share episode (Web Share API)
- ✅ Like episode
- ✅ Random anime
- ✅ Google AdSense ready
- ✅ In-memory cache API (hemat quota proxy)

---

## 📝 License

Open source — bebas dimodifikasi untuk kebutuhan pribadi.
Jangan lupa ⭐ jika berguna!
