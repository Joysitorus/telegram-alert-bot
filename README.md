# Telegram Crypto Alert Bot

Bot alert crypto berbasis Node.js yang mengambil candle market publik lewat CCXT, menghitung strategi teknikal, mengirim sinyal ke Telegram, dan menyimpan simulasi paper trading futures-style untuk evaluasi strategi.

Status saat ini: **alert bot + paper trading + strategy research tool**.

Bot ini **tidak mengeksekusi order real**. Real execution sengaja belum dibuat sampai readiness gate, audit keamanan, emergency stop, dan dry-run selesai.

## Ringkasan Fitur

- Scanner multi-symbol dari exchange yang didukung CCXT.
- Market spot dan swap/perpetual melalui konfigurasi `EXCHANGE` dan `MARKET_TYPE`.
- Strategi EMA, RSI, MACD, ADX, volume, breakout, safe-zone SL, order block, smart liquidity TP, market regime, higher timeframe, funding, open interest, dan long/short ratio.
- Signal-quality filter untuk mengurangi sinyal yang rawan langsung kena SL.
- Trade lifecycle: `OPEN`, `TP1_HIT`, `TP2_HIT`, `TP3_HIT`, `SL_HIT`, `EXPIRED`, dan `LIQUIDATED`.
- Partial exit TP1/TP2/TP3, fee/slippage, break-even setelah TP1, trailing setelah TP2.
- Paper trading futures-style dengan initial balance, notional, leverage, margin, liquidation, daily loss limit, drawdown limit, max notional, dan max used margin.
- Telegram command center dengan role admin/operator/viewer dan inline keyboard.
- State storage lokal atau PostgreSQL.
- State migration backup dan schema version.
- Single-instance lock untuk mencegah dua process memproses state yang sama.
- Health endpoint, dashboard HTML, dashboard JSON, dan Prometheus metrics.
- Replay baseline via `npm run replay`.
- Test suite via `npm test`.
- Railway deployment config via `railway.json`.

## Cara Kerja

```text
Exchange public API
  -> CCXT fetchOHLCV
  -> candle tertutup
  -> hitung indikator dan market context
  -> jalankan filter strategi dan risk guard
  -> kirim alert Telegram
  -> simpan signal decision dan paper trade
  -> update lifecycle TP/SL/liquidation pada candle berikutnya
```

Bot hanya memakai candle tertutup untuk mengurangi repaint. Jika TP dan SL tersentuh dalam candle yang sama, lifecycle dihitung konservatif karena data OHLC tidak memberi urutan intrabar.

## Instalasi Lokal

Butuh Node.js 18 atau lebih baru.

```bash
npm install
```

Copy konfigurasi:

```bash
cp .env.example .env
```

Di Windows PowerShell:

```powershell
copy .env.example .env
```

Isi minimal:

```env
TELEGRAM_BOT_TOKEN=isi_token_bot_telegram_kamu
TELEGRAM_CHAT_ID=isi_chat_id_telegram_kamu
EXCHANGE=bitget
MARKET_TYPE=swap
SYMBOLS=SUI/USDT:USDT,PEPE/USDT:USDT
TIMEFRAME=15m
CHECK_INTERVAL_SECONDS=300
```

Jalankan bot:

```bash
npm start
```

Scan sekali saja:

```bash
npm run once
```

## Script NPM

```bash
npm start       # menjalankan scanner normal
npm run once    # scan satu kali lalu exit
npm run replay  # replay baseline dari candle exchange
npm run check   # syntax check file JS utama
npm test        # menjalankan test Node.js
```

## Struktur Project

```text
telegram-crypto-alert-bot/
|-- src/
|   |-- index.js        # entry point scanner
|   |-- config.js       # env config, validation, config hash
|   |-- strategy.js     # sinyal, filters, TP/SL, market context
|   |-- indicators.js   # indikator teknikal
|   |-- state.js        # state, lifecycle, paper trading, risk guard
|   |-- storage.js      # file/PostgreSQL storage dan locking
|   |-- commands.js     # Telegram commands dan role access
|   |-- telegram.js     # formatter dan sender Telegram
|   |-- health.js       # /health, /dashboard, /dashboard.json, /metrics
|   |-- replay.js       # replay baseline
|   |-- reliability.js  # retry dan error cooldown
|   `-- utils.js        # helper umum
|-- test/
|   `-- state.test.js
|-- .env.example
|-- railway.json
|-- package.json
|-- ROADMAP.md
`-- README.md
```

## Telegram Setup

1. Chat `@BotFather`.
2. Jalankan `/newbot`.
3. Simpan token ke `TELEGRAM_BOT_TOKEN`.
4. Kirim `/start` ke bot.
5. Ambil chat id dari:

```text
https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getUpdates
```

6. Isi `TELEGRAM_CHAT_ID`.

Command polling aktif secara default:

```env
TELEGRAM_SYNC_COMMANDS=true
TELEGRAM_COMMANDS_ENABLED=true
TELEGRAM_COMMAND_POLL_TIMEOUT_SECONDS=25
```

`TELEGRAM_SYNC_COMMANDS=true` mendaftarkan menu command Telegram via `setMyCommands` saat startup. Ini hanya memperbarui daftar command yang muncul saat mengetik `/`; pemrosesan command tetap dikontrol oleh `TELEGRAM_COMMANDS_ENABLED`.

Role command:

```env
TELEGRAM_ADMIN_IDS=
TELEGRAM_OPERATOR_IDS=
TELEGRAM_VIEWER_IDS=
```

Jika `TELEGRAM_ADMIN_IDS` kosong, hanya `TELEGRAM_CHAT_ID` yang boleh memakai command. Admin dan operator bisa menjalankan command kontrol. Viewer hanya untuk command baca.

## Command Telegram

- `/start` dan `/help` - bantuan command.
- `/status` - status scanner, scan terakhir, dan error terakhir.
- `/performance` - performa all-time.
- `/paper` - ringkasan paper trading.
- `/risk` - exposure, margin, daily PnL, liquidation, dan kill switch.
- `/lesson` - ringkasan pembelajaran hasil sinyal dan setup yang sedang lemah/kuat.
- `/equity` - alias ringkasan saldo paper.
- `/drawdown` - drawdown paper account.
- `/rejected` - alasan sinyal atau paper trade ditolak.
- `/lastsignal SYMBOL` - keputusan terakhir untuk symbol tertentu.
- `/why SYMBOL` - alias untuk melihat alasan terakhir.
- `/backup` - ringkasan state untuk backup cepat.
- `/exportbackup` - kirim file backup state `.json.gz` ke Telegram.
- `/open` - trade terbuka.
- `/symbols` - daftar symbol yang dipantau.
- `/settings` - setting utama bot.
- `/pause` - pause scanner.
- `/resume` - lanjutkan scanner.
- `/scanonce` - jadwalkan scan manual sekali.
- `/setpaper on|off|default` - override paper trading runtime.
- `/setpaused SYMBOL on|off` - pause/resume symbol tertentu.

## Konfigurasi Exchange

Contoh Bitget USDT perpetual:

```env
EXCHANGE=bitget
MARKET_TYPE=swap
SYMBOLS=SUI/USDT:USDT,PEPE/USDT:USDT,TAO/USDT:USDT,ENA/USDT:USDT
TIMEFRAME=15m
CANDLE_LIMIT=1000
CHECK_INTERVAL_SECONDS=300
```

Contoh Binance spot:

```env
EXCHANGE=binance
MARKET_TYPE=spot
SYMBOLS=BTC/USDT,ETH/USDT
TIMEFRAME=15m
CANDLE_LIMIT=1000
CHECK_INTERVAL_SECONDS=300
```

Contoh Binance USD-M futures:

```env
EXCHANGE=binanceusdm
MARKET_TYPE=swap
SYMBOLS=BTC/USDT:USDT,1000PEPE/USDT:USDT
TIMEFRAME=15m
CANDLE_LIMIT=1000
CHECK_INTERVAL_SECONDS=300
```

Format symbol futures bisa berbeda antar exchange. Jika symbol tidak ditemukan, cek format market CCXT untuk exchange tersebut.

## Strategi

Konfirmasi utama BUY:

1. Close di atas EMA 200.
2. EMA 20 di atas EMA 50.
3. RSI di atas 50.
4. MACD histogram positif dan naik.
5. Volume di atas volume moving average.
6. Breakout high sebelumnya.
7. ADX kuat dan DI+ di atas DI-.

Konfirmasi utama SELL:

1. Close di bawah EMA 200.
2. EMA 20 di bawah EMA 50.
3. RSI di bawah 50.
4. MACD histogram negatif dan turun.
5. Volume di atas volume moving average.
6. Breakdown low sebelumnya.
7. ADX kuat dan DI- di atas DI+.

Default:

```env
MIN_CONFIRM=5
MIN_RR=3.0
```

### Safe-Zone SL

SL tidak memakai jarak fixed. Bot mencari area invalidasi dari order block dan recent swing, lalu menambah buffer ATR.

```env
SAFE_SL_LOOKBACK=20
SAFE_SL_BUFFER_ATR=0.35
MAX_SAFE_SL_PERCENT=5.0
```

Jika jarak SL melebihi `MAX_SAFE_SL_PERCENT`, sinyal ditolak.

### Smart Liquidity TP

TP3 dicari dari pivot high/low historis yang dianggap sebagai area liquidity. Kandidat diberi score dari jumlah touch, volume, RR, trend EMA 200, dan jarak ATR.

```env
LIQUIDITY_TOUCH_LOOKBACK=150
MAX_LIQUIDITY_CANDIDATES=40
LIQUIDITY_TOLERANCE_ATR=0.35
MIN_LIQUIDITY_TOUCHES=2
MAX_TARGET_ATR_DISTANCE=20.0
```

### Order Block

```env
REQUIRE_ORDER_BLOCK=true
ORDER_BLOCK_LOOKBACK=120
ORDER_BLOCK_IMPULSE_LOOKAHEAD=6
ORDER_BLOCK_MIN_DISPLACEMENT_ATR=1.2
ORDER_BLOCK_MAX_ZONE_ATR=2.0
ORDER_BLOCK_MAX_ENTRY_DISTANCE_ATR=1.5
MIN_ORDER_BLOCK_SCORE=60
```

### Signal-Quality Filter

Filter ini dibuat untuk menolak sinyal yang entry-nya terlalu lemah, terlalu jauh, atau kualitas candle/volume-nya buruk.

```env
ENTRY_MODE=breakout_close
MIN_BREAKOUT_ATR=0
MAX_BREAKOUT_EXTENSION_ATR=0
MIN_CANDLE_BODY_PERCENT=0
MAX_ENTRY_WICK_PERCENT=100
MIN_VOLUME_RATIO=0
REJECT_FALLBACK_LIQUIDITY_TARGET=false
IGNORE_LAST_DIRECTION_BLOCK=false
```

`ENTRY_MODE` mendukung:

- `breakout_close`
- `breakout_retest`
- `pullback_trend`

### Profile, Override, HTF, dan Market Regime

```env
STRATEGY_PROFILE=
STRATEGY_VERSION=breakout_v1
STRATEGY_PROFILES_JSON=
SYMBOL_STRATEGY_OVERRIDES_JSON=
HIGHER_TIMEFRAME=
REQUIRE_HIGHER_TIMEFRAME_TREND=false
SIGNAL_COOLDOWN_SECONDS=0
MARKET_REGIME_FILTER=
MARKET_REGIME_TREND_ADX=25
MARKET_REGIME_HIGH_VOL_ATR_PERCENT=2
```

`MARKET_REGIME_FILTER` bisa berisi:

- `trending`
- `ranging`
- `high_volatility`
- `low_volatility`

Override per symbol memakai JSON:

```env
SYMBOL_STRATEGY_OVERRIDES_JSON={"BTC/USDT:USDT":{"minConfirm":6,"minRR":2.5}}
```

### Futures Context Filter

Filter ini tergantung dukungan exchange CCXT. Jika filter diaktifkan tetapi exchange tidak menyediakan data, sinyal bisa ditolak dan reason disimpan.

```env
MAX_ABS_FUNDING_RATE=0
MAX_POSITIVE_FUNDING_LONG=0
MAX_NEGATIVE_FUNDING_SHORT=0
MIN_OPEN_INTEREST=0
MAX_OPEN_INTEREST=0
MIN_LONG_SHORT_RATIO=0
MAX_LONG_SHORT_RATIO=0
```

Nilai `0` berarti filter nonaktif.

## Paper Trading Futures-Style

Paper trading menyimpan sinyal sebagai simulasi trade, tanpa order real.

```env
PAPER_TRADING_ENABLED=false
PAPER_TRADING_INITIAL_BALANCE=100
PAPER_TRADING_POSITION_NOTIONAL=500
PAPER_TRADING_LEVERAGE=75
PAPER_TRADING_MAINTENANCE_MARGIN_PERCENT=0.5
PAPER_TRADING_FEE_PERCENT=0
PAPER_TRADING_SLIPPAGE_PERCENT=0
PAPER_TRADING_MAX_OPEN_TRADES=0
```

Contoh:

- Saldo awal: `100 USDT`
- Notional per entry: `500 USDT`
- Leverage: `75x`
- Initial margin kira-kira: `500 / 75 = 6.67 USDT`

PnL dihitung dari notional, bukan dari margin. Pergerakan harga 1% pada posisi `500 USDT` menghasilkan sekitar `5 USDT` sebelum fee/slippage.

Jika liquidation price tersentuh sebelum TP/SL, outcome paper menjadi `LIQUIDATED`. Jika saldo tersedia tidak cukup untuk margin dan entry fee, alert utama tetap bisa dikirim, tetapi paper trade ditolak dan reason tercatat di `/rejected`.

### Paper Risk Guard

```env
PAPER_TRADING_RISK_MODE=fixed_notional
PAPER_TRADING_FIXED_MARGIN=0
PAPER_TRADING_RISK_PERCENT_EQUITY=1
PAPER_TRADING_MAX_LOSS_USDT=0
PAPER_TRADING_MAX_LOSS_PERCENT_EQUITY=0
PAPER_TRADING_MIN_LIQUIDATION_BUFFER_PERCENT=0
PAPER_TRADING_DAILY_LOSS_LIMIT_USDT=0
PAPER_TRADING_MAX_DRAWDOWN_PERCENT=0
PAPER_TRADING_MAX_OPEN_NOTIONAL=0
PAPER_TRADING_MAX_USED_MARGIN=0
PAPER_TRADING_BREAK_EVEN_AFTER_TP1=false
PAPER_TRADING_TRAIL_AFTER_TP2=false
```

Risk mode:

- `fixed_notional` - setiap sinyal memakai `PAPER_TRADING_POSITION_NOTIONAL`.
- `fixed_margin` - notional dihitung dari `PAPER_TRADING_FIXED_MARGIN * leverage`.
- `risk_percent_equity` - sizing mengikuti estimasi loss ke SL.
- `volatility_target` - saat ini memakai basis risk-percent, disiapkan untuk volatility scaling.

Paper trade bisa ditolak jika:

- liquidation price berada sebelum SL.
- estimasi max loss melebihi batas.
- daily loss limit tercapai.
- max drawdown tercapai.
- max open notional tercapai.
- max used margin tercapai.
- saldo tidak cukup untuk margin dan fee.

## Performance Report

Bot menyimpan trade lifecycle dan mengirim laporan mingguan/bulanan jika diaktifkan.

```env
WEEKLY_PERFORMANCE_REPORT_ENABLED=true
MONTHLY_PERFORMANCE_REPORT_ENABLED=true
PERFORMANCE_REPORT_TIMEZONE=Asia/Jakarta
PERFORMANCE_REPORT_DAY=1
PERFORMANCE_REPORT_HOUR=8
MONTHLY_PERFORMANCE_REPORT_DAY=1
MONTHLY_PERFORMANCE_REPORT_HOUR=8
TRADE_EXPIRY_CANDLES=0
TP1_EXIT_PORTION=0.33
TP2_EXIT_PORTION=0.33
```

`PERFORMANCE_REPORT_DAY` memakai `0` untuk Minggu sampai `6` untuk Sabtu.

Metrics yang dilacak meliputi winrate, TP hit rate, average R, average PnL, paper balance, drawdown, rejected trade, liquidation, dan open exposure.

## Backup Export

Bot bisa mengirim backup state sebagai file `.json.gz` ke Telegram. Backup berisi state bot, trade history, paper account, signal decisions, market snapshots, lesson, dan lesson stats. Backup tidak menyertakan env secret seperti `TELEGRAM_BOT_TOKEN` atau `DATABASE_URL`.

```env
BACKUP_EXPORT_ENABLED=true
DAILY_BACKUP_ENABLED=true
DAILY_BACKUP_TIMEZONE=Asia/Jakarta
DAILY_BACKUP_HOUR=8
```

Gunakan `/exportbackup` untuk backup manual. Command ini hanya bisa dipakai owner/admin. Jika `DAILY_BACKUP_ENABLED=true`, bot akan mengirim backup otomatis sekali per hari setelah jam `DAILY_BACKUP_HOUR` pada timezone `DAILY_BACKUP_TIMEZONE`.

## Lesson Learning

Lesson learning mencatat hasil setiap sinyal yang sudah selesai sebagai lesson. Data yang disimpan meliputi symbol, arah, entry mode, market regime, score bucket, RR bucket, SL risk bucket, outcome, realized R, dan durasi trade. Jika `DATABASE_URL` aktif di Railway, lesson ikut tersimpan di `bot_state` dan juga disinkronkan ke tabel `bot_lessons` serta `bot_lesson_stats`.

```env
LESSON_ENABLED=true
LESSON_APPLY_FILTER=true
LESSON_MIN_SAMPLES=8
LESSON_MIN_WIN_RATE=35
LESSON_MIN_AVG_R=0
LESSON_MAX_LOSING_STREAK=4
LESSON_MAX_RECORDS=2000
```

Jika filter aktif, sinyal baru akan ditolak saat setup historis yang mirip sudah punya minimal `LESSON_MIN_SAMPLES` dan performanya buruk, misalnya winrate di bawah `LESSON_MIN_WIN_RATE`, average R di bawah `LESSON_MIN_AVG_R`, atau losing streak mencapai `LESSON_MAX_LOSING_STREAK`.

Gunakan `/lesson` untuk melihat ringkasan weak setup, strong setup, dan lesson terbaru.

## Storage dan State

Default memakai file lokal:

```env
STATE_FILE=./state.json
```

Untuk production, gunakan PostgreSQL:

```env
DATABASE_URL=postgresql://user:password@host:5432/database
```

Jika `DATABASE_URL` diisi, bot memakai PostgreSQL dan membuat state table yang dibutuhkan. Saat migrasi awal, state file lama bisa dibaca lalu disimpan ke database.

Runtime guard:

```env
SINGLE_INSTANCE_LOCK_ENABLED=true
LOCK_FILE=./bot.lock
DATA_RETENTION_DAYS=30
```

File storage memakai lock file lokal. PostgreSQL memakai advisory lock.

## Health, Dashboard, dan Metrics

```env
HEALTHCHECK_ENABLED=false
HEALTHCHECK_PORT=3000
DASHBOARD_ENABLED=false
```

Endpoint:

- `GET /health` - status scanner, last successful scan, dan error terakhir.
- `GET /dashboard` - dashboard HTML ringan.
- `GET /dashboard.json` - snapshot dashboard.
- `GET /metrics` - Prometheus metrics.

Catatan: `health.js` hanya start server jika `HEALTHCHECK_ENABLED=true` atau `DASHBOARD_ENABLED=true`. Endpoint `/metrics` tersedia pada server yang sama.

## Reliability Runtime

```env
RETRY_ATTEMPTS=3
RETRY_DELAY_MS=1000
ERROR_ALERT_COOLDOWN_SECONDS=900
LOG_LEVEL=info
SEND_STARTUP_MESSAGE=true
ALERT_ERRORS=true
HEARTBEAT_ENABLED=false
HEARTBEAT_INTERVAL_HOURS=24
```

Retry dipakai untuk request exchange dan Telegram. Error alert cooldown mencegah spam jika error yang sama berulang.

## Replay dan Testing

Replay baseline:

```bash
npm run replay
```

Syntax check:

```bash
npm run check
```

Test:

```bash
npm test
```

Test saat ini mencakup paper liquidation, partial target/margin release, dan daily loss limit. Roadmap berikutnya memprioritaskan coverage lifecycle dan strategy filter yang lebih luas.

## Deploy ke Railway

Project sudah memiliki `railway.json`.

Langkah umum:

1. Push repo ke GitHub.
2. Buat Railway project dari GitHub repo.
3. Pastikan service memakai command `npm start`.
4. Isi Variables berdasarkan `.env.example`.
5. Gunakan PostgreSQL atau persistent volume untuk state production.
6. Aktifkan `SINGLE_INSTANCE_LOCK_ENABLED=true`.
7. `railway.json` default tidak memakai healthcheck karena bot berjalan sebagai worker tanpa HTTP listener wajib. Jika ingin memakai endpoint health, aktifkan `HEALTHCHECK_ENABLED=true` dan tambahkan healthcheck path `/health` di Railway.
8. Redeploy service.

Minimal variables production:

```env
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
EXCHANGE=bitget
MARKET_TYPE=swap
SYMBOLS=SUI/USDT:USDT,PEPE/USDT:USDT
TIMEFRAME=15m
CANDLE_LIMIT=1000
CHECK_INTERVAL_SECONDS=300
DATABASE_URL=...
```

## Rekomendasi Setting Awal

Untuk evaluasi awal 15m:

```env
TIMEFRAME=15m
CHECK_INTERVAL_SECONDS=300
MIN_CONFIRM=5
MIN_RR=3.0
SAFE_SL_LOOKBACK=20
SAFE_SL_BUFFER_ATR=0.35
MAX_SAFE_SL_PERCENT=5.0
LIQUIDITY_TOUCH_LOOKBACK=150
LIQUIDITY_TOLERANCE_ATR=0.35
MIN_LIQUIDITY_TOUCHES=2
MAX_TARGET_ATR_DISTANCE=20.0
PAPER_TRADING_ENABLED=true
PAPER_TRADING_INITIAL_BALANCE=100
PAPER_TRADING_POSITION_NOTIONAL=500
PAPER_TRADING_LEVERAGE=75
PAPER_TRADING_MIN_LIQUIDATION_BUFFER_PERCENT=0
```

Jika sinyal terlalu sering dan banyak langsung SL:

```env
MIN_CONFIRM=6
MIN_VOLUME_RATIO=1.2
MIN_CANDLE_BODY_PERCENT=45
MAX_ENTRY_WICK_PERCENT=35
REJECT_FALLBACK_LIQUIDITY_TARGET=true
```

Jika leverage 75x terlalu sering dekat liquidation:

```env
PAPER_TRADING_MIN_LIQUIDATION_BUFFER_PERCENT=0.5
PAPER_TRADING_MAX_LOSS_PERCENT_EQUITY=3
PAPER_TRADING_DAILY_LOSS_LIMIT_USDT=5
PAPER_TRADING_MAX_DRAWDOWN_PERCENT=15
```

## Troubleshooting

### Bot tidak kirim Telegram

- Cek `TELEGRAM_BOT_TOKEN`.
- Cek `TELEGRAM_CHAT_ID`.
- Kirim `/start` ke bot.
- Jika target group/channel, pastikan bot sudah masuk dan punya izin.
- Cek Railway Variables dan redeploy.

### Symbol tidak ditemukan

- Cek format symbol sesuai exchange CCXT.
- Spot biasanya `BTC/USDT`.
- USDT perpetual sering memakai `BTC/USDT:USDT`.
- Beberapa contract memakai prefix seperti `1000PEPE/USDT:USDT`.

### Tidak ada sinyal

- Candle belum cukup untuk indikator.
- Market tidak memenuhi confirmation.
- `MIN_CONFIRM`, `MIN_RR`, atau order block terlalu ketat.
- HTF/regime/funding/OI filter menolak sinyal.
- Cek `/rejected` atau `/why SYMBOL`.

### Sinyal banyak kena SL

- Naikkan `MIN_CONFIRM`.
- Aktifkan filter body/wick/volume.
- Aktifkan `REJECT_FALLBACK_LIQUIDITY_TARGET=true`.
- Gunakan `breakout_retest` atau `pullback_trend` untuk menghindari entry chasing.
- Evaluasi lewat paper trading, bukan dari beberapa alert saja.

### Paper trade ditolak

- Cek `/risk` dan `/rejected`.
- Kemungkinan saldo margin tidak cukup.
- Liquidation terlalu dekat dengan SL.
- Daily loss atau drawdown limit tercapai.
- Max notional atau max used margin tercapai.

## Roadmap

Roadmap terbaru ada di `ROADMAP.md`.

Prioritas berikutnya:

1. Validation dan test coverage.
2. Exchange-specific futures accuracy.
3. Research data warehouse.
4. Strategy lab dan walk-forward.
5. Advanced signal quality.
6. Portfolio risk dan capital allocation.
7. Dashboard v2.
8. Telegram UX lanjutan.
9. Production operations.
10. Real execution readiness gate.

## Catatan Akurasi

Hasil bot bisa berbeda dari TradingView karena:

- sumber data exchange berbeda.
- spot dan futures memiliki candle berbeda.
- implementasi indikator bisa berbeda.
- bot memakai candle tertutup.
- liquidity/order block adalah proxy teknikal, bukan order book atau liquidation heatmap asli.
- funding/OI/long-short ratio tergantung dukungan exchange.

Bot tidak menjamin profit. Gunakan sebagai alat bantu monitoring, riset, dan evaluasi paper trading.

## Referensi

- CCXT Documentation: https://docs.ccxt.com/
- CCXT GitHub: https://github.com/ccxt/ccxt
- Telegram Bot API: https://core.telegram.org/bots/api
- Railway Docs: https://docs.railway.com/
- Binance USD-M Kline Data: https://developers.binance.com/docs/derivatives/usds-margined-futures/market-data/rest-api/Kline-Candlestick-Data

## License

MIT License. Lihat `LICENSE`.

## Disclaimer

Bot ini bukan nasihat finansial. Semua keputusan trading tetap tanggung jawab pengguna. Crypto sangat volatil dan bisa menyebabkan kerugian besar.
