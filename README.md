# Telegram Crypto Alert Bot

Bot ini menggantikan kebutuhan alert TradingView berbayar dengan cara mengambil data candle langsung dari exchange melalui CCXT, menghitung indikator teknikal, menentukan sinyal BUY/SELL, lalu mengirim notifikasi ke Telegram.

Bot ini cocok untuk:

- alert crypto tanpa TradingView Premium
- monitoring PEPE, BTC, ETH, atau pair lain
- deployment di Railway sebagai Worker
- strategi berbasis EMA, RSI, MACD, ADX, volume, safe-zone SL, order block, dan smart liquidity TP

> Bot ini hanya mengirim alert. Bot ini **tidak melakukan eksekusi order**.

---

## 1. Cara Kerja

Alur kerja bot:

```text
Exchange public API
        ↓
CCXT fetchOHLCV
        ↓
Ambil candle tertutup
        ↓
Hitung indikator teknikal
        ↓
Cek sinyal BUY / SELL
        ↓
Hitung Entry, SL, TP1, TP2, TP3
        ↓
Kirim alert ke Telegram
```

Bot menggunakan data candle OHLCV dari exchange. Di CCXT, method `fetchOHLCV` digunakan untuk mengambil historical candlestick data. CCXT sendiri menyediakan akses ke market data, indikator, backtesting, bot trading, dan banyak exchange melalui satu library.

---

## 2. Fitur

- Ambil candle market publik dari Binance, Bitget, Binance Futures, dan exchange lain yang didukung CCXT.
- Tidak perlu TradingView.
- Tidak perlu webhook TradingView.
- Tidak perlu API key untuk market data publik.
- Kirim alert langsung ke Telegram Bot.
- Support multi-symbol.
- Support Railway Worker.
- Menghindari alert duplikat dengan file `state.json`.
- SL dinamis di luar order block/swing dengan buffer ATR.
- TP3 menggunakan smart liquidity target.
- TP1 dan TP2 otomatis mengikuti jarak menuju TP3.
- Score probabilitas berdasarkan 7 konfirmasi teknikal.
- RR minimal ke TP3 bisa diatur.

---

## 3. Strategi yang Dipakai

Bot menghitung 7 konfirmasi untuk BUY dan SELL.

### BUY confirmation

1. Close di atas EMA 200
2. EMA 20 di atas EMA 50
3. RSI di atas 50
4. MACD histogram positif dan naik
5. Volume di atas Volume MA
6. Higher high atau breakout high sebelumnya
7. ADX di atas 20 dan DI+ di atas DI-

### SELL confirmation

1. Close di bawah EMA 200
2. EMA 20 di bawah EMA 50
3. RSI di bawah 50
4. MACD histogram negatif dan turun
5. Volume di atas Volume MA
6. Lower low atau breakdown low sebelumnya
7. ADX di atas 20 dan DI- di atas DI+

Default minimal konfirmasi:

```env
MIN_CONFIRM=5
```

Artinya sinyal hanya muncul jika minimal 5 dari 7 konfirmasi terpenuhi.

---

## 4. Safe-Zone SL

SL tidak lagi memakai jarak fixed 2% dari entry. Bot menempatkan SL di area invalidasi yang lebih aman:

- Untuk BUY: di bawah order block low atau recent swing low, ditambah buffer ATR.
- Untuk SELL: di atas order block high atau recent swing high, ditambah buffer ATR.

Default:

```env
SAFE_SL_LOOKBACK=20
SAFE_SL_BUFFER_ATR=0.35
MAX_SAFE_SL_PERCENT=5.0
```

Jika jarak SL lebih besar dari `MAX_SAFE_SL_PERCENT`, sinyal ditolak agar risiko tidak terlalu lebar.

Untuk BUY:

```text
SL = min(order block low, recent swing low) - ATR buffer
```

Untuk SELL:

```text
SL = max(order block high, recent swing high) + ATR buffer
```

---

## 5. Smart Liquidity TP

TP3 tidak hanya memakai target RR statis. Bot mencari pivot high atau pivot low historis yang dianggap sebagai area liquidity.

### Untuk BUY

Target TP3 dicari dari pivot high di atas entry.

### Untuk SELL

Target TP3 dicari dari pivot low di bawah entry.

Setiap kandidat liquidity diberi score berdasarkan:

- jumlah touch di area tersebut
- volume di sekitar level
- RR yang dihasilkan
- bonus jika searah trend EMA 200
- penalti jika target terlalu jauh berdasarkan ATR

Jika tidak ada liquidity target yang valid, bot memakai fallback:

```text
TP3 = Entry ± minimal RR
```

Default:

```env
MIN_RR=3.0
```

---

## 6. Struktur Folder

```text
telegram-crypto-alert-bot/
├── src/
│   ├── index.js        # entry point bot
│   ├── config.js       # membaca ENV dan validasi config
│   ├── indicators.js   # EMA, RSI, MACD, ATR, ADX, pivot
│   ├── strategy.js     # logic sinyal dan smart liquidity TP
│   ├── telegram.js     # format dan kirim pesan Telegram
│   ├── state.js        # menyimpan state agar tidak spam alert
│   └── utils.js        # helper umum
├── .env.example
├── .gitignore
├── package.json
├── README.md
└── LICENSE
```

---

## 7. Instalasi Lokal

Pastikan Node.js versi 18 atau lebih baru sudah terinstall.

Install dependency:

```bash
npm install
```

Copy `.env.example` menjadi `.env`:

```bash
cp .env.example .env
```

Di Windows PowerShell:

```powershell
copy .env.example .env
```

Edit `.env` dan isi token Telegram serta setting exchange.

Jalankan bot:

```bash
npm start
```

Scan sekali saja:

```bash
npm run once
```

---

## 8. Cara Membuat Telegram Bot

1. Buka Telegram.
2. Chat ke `@BotFather`.
3. Kirim `/newbot`.
4. Ikuti instruksi sampai mendapat token.
5. Isi token ke `.env`:

```env
TELEGRAM_BOT_TOKEN=token_dari_botfather
```

Untuk mendapatkan `TELEGRAM_CHAT_ID`:

1. Kirim `/start` ke bot kamu.
2. Buka URL berikut di browser:

```text
https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getUpdates
```

3. Cari bagian:

```json
"chat": { "id": 123456789 }
```

4. Isi ke `.env`:

```env
TELEGRAM_CHAT_ID=123456789
```

Telegram Bot API adalah HTTP-based interface untuk developer yang ingin membuat bot Telegram. Bot ini memakai endpoint `sendMessage` melalui HTTP POST.

---

## 9. Contoh `.env` untuk Bitget Perpetual

```env
TELEGRAM_BOT_TOKEN=123456789:AAxxxx
TELEGRAM_CHAT_ID=123456789

EXCHANGE=bitget
MARKET_TYPE=swap
SYMBOLS=PEPE/USDT:USDT,BTC/USDT:USDT
TIMEFRAME=15m
CANDLE_LIMIT=1000
CHECK_INTERVAL_SECONDS=60

SAFE_SL_LOOKBACK=20
SAFE_SL_BUFFER_ATR=0.35
MAX_SAFE_SL_PERCENT=5.0
MIN_RR=3.0
MIN_CONFIRM=5

LIQUIDITY_TOUCH_LOOKBACK=150
MAX_LIQUIDITY_CANDIDATES=40
LIQUIDITY_TOLERANCE_ATR=0.35
MIN_LIQUIDITY_TOUCHES=2
MAX_TARGET_ATR_DISTANCE=20.0
```

---

## 10. Contoh `.env` untuk Binance Spot

```env
TELEGRAM_BOT_TOKEN=123456789:AAxxxx
TELEGRAM_CHAT_ID=123456789

EXCHANGE=binance
MARKET_TYPE=spot
SYMBOLS=PEPE/USDT,BTC/USDT
TIMEFRAME=15m
CANDLE_LIMIT=1000
CHECK_INTERVAL_SECONDS=60
```

---

## 11. Contoh `.env` untuk Binance USD-M Futures

```env
TELEGRAM_BOT_TOKEN=123456789:AAxxxx
TELEGRAM_CHAT_ID=123456789

EXCHANGE=binanceusdm
MARKET_TYPE=swap
SYMBOLS=1000PEPE/USDT:USDT,BTC/USDT:USDT
TIMEFRAME=15m
CANDLE_LIMIT=1000
CHECK_INTERVAL_SECONDS=60
```

Catatan: format symbol futures di CCXT bisa berbeda antar exchange. Jika bot memberi warning symbol tidak ditemukan, cek daftar market exchange atau coba format symbol lain.

---

## 12. Deploy ke Railway

1. Push project ini ke GitHub.
2. Buka Railway.
3. Pilih **New Project**.
4. Pilih **Deploy from GitHub repo**.
5. Pilih repository bot ini.
6. Railway akan mendeteksi `package.json` dan menjalankan `npm start`.
7. Masuk ke service Railway.
8. Buka tab **Variables**.
9. Tambahkan environment variable dari `.env.example`.

Railway menyediakan tab Variables untuk mengatur variable service. Untuk project Node.js, Railway dapat deploy dari GitHub dan mendeteksi app Node.js dari `package.json`.

---

## 13. Railway Variables yang Wajib

Isi di Railway:

```env
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
EXCHANGE=bitget
MARKET_TYPE=swap
SYMBOLS=PEPE/USDT:USDT
TIMEFRAME=15m
CANDLE_LIMIT=1000
CHECK_INTERVAL_SECONDS=60
```

Tidak perlu mengisi `PORT` karena bot ini Worker, bukan web server.

---

## 14. Cara Kerja Anti-Spam Alert

Bot menyimpan file `state.json` dengan isi seperti:

```json
{
  "pairs": {
    "bitget:PEPE/USDT:USDT:15m": {
      "lastDirection": -1,
      "lastSignalCandleTime": 1710000000000
    }
  }
}
```

Tujuannya:

- tidak mengirim sinyal yang sama berulang-ulang
- tidak mengirim BUY lagi jika sinyal terakhir sudah BUY
- tidak mengirim SELL lagi jika sinyal terakhir sudah SELL
- sinyal baru akan muncul jika arah berubah

Catatan: jika Railway redeploy dan filesystem reset, state bisa hilang. Untuk penggunaan serius, simpan state di database seperti Redis/Postgres.

---

## 15. Pengaturan yang Paling Penting

### `SYMBOLS`

Pair yang dipantau.

```env
SYMBOLS=PEPE/USDT:USDT,BTC/USDT:USDT
```

### `TIMEFRAME`

Timeframe candle.

```env
TIMEFRAME=15m
```

### `CHECK_INTERVAL_SECONDS`

Interval scan.

```env
CHECK_INTERVAL_SECONDS=60
```

Untuk timeframe 15m, scan tiap 60 detik cukup karena bot hanya memakai candle tertutup.

### `SAFE_SL_LOOKBACK`

Jumlah candle terakhir untuk mencari swing low/high sebagai area aman SL.

```env
SAFE_SL_LOOKBACK=20
```

### `SAFE_SL_BUFFER_ATR`

Buffer ATR agar SL berada sedikit di luar area order block/swing.

```env
SAFE_SL_BUFFER_ATR=0.35
```

### `MAX_SAFE_SL_PERCENT`

Batas maksimum jarak SL dari entry. Jika SL dinamis lebih jauh dari angka ini, sinyal ditolak.

```env
MAX_SAFE_SL_PERCENT=5.0
```

### `MIN_RR`

Minimal RR ke TP3.

```env
MIN_RR=3.0
```

Jika ingin target profit lebih besar:

```env
MIN_RR=5.0
```

### `MIN_CONFIRM`

Minimal konfirmasi indikator.

```env
MIN_CONFIRM=5
```

Lebih ketat:

```env
MIN_CONFIRM=6
```

---

## 16. Rekomendasi Setting PEPE

Untuk PEPE 15m:

```env
TIMEFRAME=15m
CHECK_INTERVAL_SECONDS=60
SAFE_SL_LOOKBACK=20
SAFE_SL_BUFFER_ATR=0.35
MAX_SAFE_SL_PERCENT=5.0
MIN_RR=3.0
MIN_CONFIRM=5
LIQUIDITY_TOUCH_LOOKBACK=150
LIQUIDITY_TOLERANCE_ATR=0.35
MIN_LIQUIDITY_TOUCHES=2
MAX_TARGET_ATR_DISTANCE=20.0
```

Jika sinyal terlalu sering:

```env
MIN_CONFIRM=6
MIN_LIQUIDITY_TOUCHES=3
```

Jika TP terlalu jauh:

```env
MAX_TARGET_ATR_DISTANCE=12.0
MIN_RR=3.0
```

Jika TP terlalu dekat:

```env
MIN_RR=5.0
LIQUIDITY_TOUCH_LOOKBACK=300
```

---

## 17. Contoh Output Telegram

```text
🔴 SELL SIGNAL

Pair: bitget:PEPE/USDT:USDT
Timeframe: 15m
Candle: 2026-05-18 10:15:00 UTC
Trend: BEARISH

Entry: 0.0000039505
SL Safe Zone 3.1%: 0.000004073
SL Source: order_block_swing_high

TP1: 0.00000382
TP2: 0.00000367
TP3 Smart Liquidity: 0.00000355

RR TP3: 5.07R
Probability: 73%
Score: 6/7

Liquidity Source: smart_liquidity
Liquidity Score: 92.4
Liquidity Touches: 4
Order Block Score: 76.5
Order Block Zone: 0.00000401 - 0.00000406
Order Block Age: 8 candles
```

---

## 18. Troubleshooting

### Bot tidak mengirim Telegram

Cek:

- `TELEGRAM_BOT_TOKEN` benar
- `TELEGRAM_CHAT_ID` benar
- kamu sudah kirim `/start` ke bot
- kalau target group/channel, bot sudah dimasukkan
- kalau channel, bot sudah jadi admin
- Railway variables sudah disimpan
- service sudah redeploy

### Error symbol tidak ditemukan

Coba format symbol lain.

Bitget perpetual umumnya:

```env
SYMBOLS=PEPE/USDT:USDT
```

Binance spot:

```env
SYMBOLS=PEPE/USDT
```

Binance USD-M futures:

```env
SYMBOLS=1000PEPE/USDT:USDT
```

### Tidak ada sinyal

Kemungkinan:

- `MIN_CONFIRM` terlalu tinggi
- `MIN_RR` terlalu tinggi
- `MIN_LIQUIDITY_TOUCHES` terlalu tinggi
- market sedang sideways
- candle belum cukup
- timeframe terlalu besar dan perlu menunggu candle close

### Alert terlalu sering

Naikkan:

```env
MIN_CONFIRM=6
MIN_LIQUIDITY_TOUCHES=3
MIN_RR=5
```

### Bot crash di Railway

Cek log Railway. Pastikan semua variable wajib sudah diisi.

---

## 19. Catatan Data dan Akurasi

Hasil indikator bisa sedikit berbeda dari TradingView karena:

- sumber data exchange bisa berbeda
- candle futures/spot berbeda
- perhitungan indicator internal TradingView bisa sedikit berbeda
- bot hanya memakai candle tertutup
- liquidity yang dihitung adalah proxy teknikal, bukan order book/liquidation heatmap asli

Bot ini tidak menjamin profit. Gunakan sebagai alat bantu monitoring.

---

## 20. License

Project ini memakai MIT License. Kamu boleh memakai, memodifikasi, dan mengembangkan project ini, termasuk untuk penggunaan komersial, selama tetap menyertakan notice license.

Lihat file `LICENSE`.

---

## 21. Disclaimer

Bot ini bukan nasihat finansial. Semua keputusan trading tetap tanggung jawab pengguna. Crypto sangat volatil dan bisa menyebabkan kerugian besar.

---

## 22. Referensi Teknis

- CCXT Documentation: https://docs.ccxt.com/
- CCXT GitHub README: https://github.com/ccxt/ccxt
- Telegram Bot API: https://core.telegram.org/bots/api
- Railway Variables: https://docs.railway.com/variables
- Binance Kline/Candlestick Data: https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Kline-Candlestick-Data
