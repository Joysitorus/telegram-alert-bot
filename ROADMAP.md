# Roadmap Telegram Crypto Alert Bot

Dokumen ini berisi roadmap fitur dan rencana implementasi bertahap untuk meningkatkan project menjadi bot alert crypto yang lebih reliable, interaktif, dan mudah dievaluasi.

## 1. Kondisi Saat Ini

Project saat ini sudah memiliki fondasi utama:

- Scanner market menggunakan CCXT dan candle OHLCV publik.
- Support multi-symbol.
- Strategi teknikal berbasis EMA, RSI, MACD, ADX, volume, breakout, order block, dan smart liquidity target.
- Safe-zone stop loss berbasis order block/swing dan ATR buffer.
- TP1, TP2, TP3 otomatis dari jarak ke target liquidity.
- Anti-spam alert menggunakan `state.json`.
- Tracking open/closed trade sederhana dengan outcome TP2 atau SL.
- Laporan winrate mingguan dan bulanan ke Telegram.
- Deployment cocok untuk Railway Worker.

Gap utama yang perlu ditutup:

- State masih file-based dan rawan hilang saat redeploy tanpa volume/database.
- Bot belum menerima command Telegram seperti `/status`, `/performance`, `/pause`, dan `/resume`.
- Belum ada tracking lifecycle TP1/TP2/TP3/SL secara detail.
- Belum ada backtesting historis untuk validasi strategi.
- Belum ada paper trading forward-test.
- Retry, backoff, throttling error, dan observability masih minimal.
- Strategi masih monolitik dan belum mendukung profile/per-symbol override.

## 2. Tujuan Pengembangan

Tujuan utama roadmap ini:

- Membuat bot lebih stabil untuk jalan 24/7.
- Mengurangi risiko kehilangan state dan spam alert.
- Membuat bot bisa dikontrol dari Telegram.
- Membuat setiap sinyal bisa dievaluasi sampai outcome final.
- Menyediakan alat backtesting dan paper trading sebelum strategi dipakai serius.
- Memudahkan tuning parameter per symbol, timeframe, dan karakter market.
- Menyiapkan dasar untuk dashboard atau Telegram Mini App di masa depan.

## 3. Prioritas Roadmap

### P0 - Reliability dan Data Safety

Fokus: bot tidak kehilangan data penting dan tahan error runtime.

- Durable state storage dengan adapter file dan database.
- Opsi PostgreSQL untuk Railway production.
- State migration dari `state.json` lama.
- Atomic save untuk file state lokal.
- Retry dan exponential backoff untuk request exchange dan Telegram.
- Error throttling supaya Telegram tidak spam saat exchange bermasalah.
- Config validation lebih kuat untuk symbol, timeframe, dan numeric env.
- Graceful shutdown dengan final state save.

### P1 - Telegram Command Interface

Fokus: bot bisa dikontrol dan dimonitor langsung dari Telegram.

- Command listener menggunakan Telegram `getUpdates` long polling.
- Admin allowlist via env, misalnya `TELEGRAM_ADMIN_IDS`.
- Command global: `/start`, `/help`, `/settings`.
- Command monitoring: `/status`, `/performance`, `/open`, `/symbols`.
- Command kontrol: `/pause`, `/resume`, `/scanonce`.
- Inline keyboard sederhana untuk refresh status dan performance.
- Penyimpanan offset update agar command tidak diproses ulang.

### P2 - Trade Lifecycle Tracking

Fokus: setiap sinyal punya update outcome yang jelas.

- Tracking TP1, TP2, TP3, dan SL.
- Notifikasi saat target tersentuh.
- Status trade: `OPEN`, `TP1_HIT`, `TP2_HIT`, `TP3_HIT`, `SL_HIT`, `EXPIRED`.
- Partial target tracking berdasarkan porsi TP1 dan TP2.
- Estimasi PnL berbasis R dan persentase.
- Fee dan slippage estimation optional.
- Expiry logic untuk trade yang terlalu lama tidak menyentuh target atau SL.
- Report performance berdasarkan R-multiple, bukan hanya winrate.

### P3 - Backtesting dan Paper Trading

Fokus: strategi bisa diuji sebelum digunakan.

- Script backtest historis menggunakan CCXT OHLCV.
- Mode input symbol, timeframe, tanggal mulai, tanggal akhir, dan strategy config.
- Output summary: total trade, winrate, average R, max drawdown, profit factor, best/worst trade.
- Export hasil ke JSON atau CSV.
- Parameter sweep sederhana untuk `MIN_CONFIRM`, `MIN_RR`, `MAX_SAFE_SL_PERCENT`, dan filter utama.
- Paper trading mode untuk forward-test tanpa eksekusi order.
- Report paper trading harian/mingguan.

### P4 - Strategy Upgrade

Fokus: sinyal lebih adaptif terhadap market dan symbol.

- Multi-timeframe confirmation, misalnya sinyal 15m hanya valid jika 1h/4h searah.
- Strategy profiles seperti `scalping`, `swing`, `meme`, dan `major`.
- Per-symbol override untuk parameter strategi.
- Optional market regime filter: trending, ranging, high volatility, low volatility.
- Optional funding rate filter untuk futures.
- Optional open interest atau long/short ratio filter jika exchange mendukung.
- Configurable cooldown antar sinyal per symbol.

### P5 - Dashboard dan Observability

Fokus: monitoring lebih mudah saat bot sudah stabil.

- HTTP healthcheck endpoint optional.
- Heartbeat report ke Telegram.
- Structured logging.
- Log level yang benar-benar dipakai dari `LOG_LEVEL`.
- Uptime dan last successful scan tracking.
- Dashboard ringan untuk open trades dan history.
- Telegram Mini App sebagai opsi lanjutan.

## 4. Rencana Implementasi Bertahap

### Phase 1 - Fondasi Reliability

Target: bot lebih aman untuk deployment jangka panjang.

Checklist:

- Buat interface storage: `loadState`, `saveState`, `updateState`.
- Pertahankan file storage sebagai default lokal.
- Tambahkan database storage optional via `DATABASE_URL`.
- Tambahkan state migration dari format lama.
- Tambahkan retry helper untuk Telegram dan exchange calls.
- Tambahkan error throttling agar error berulang tidak spam Telegram.
- Tambahkan validasi config tambahan untuk env penting.
- Update README untuk opsi storage production.

Kriteria selesai:

- Bot tetap bisa jalan dengan file state tanpa perubahan env.
- Jika `DATABASE_URL` diisi, state tersimpan di database.
- Error exchange sementara tidak langsung membuat bot fatal.
- Error berulang tidak mengirim pesan Telegram terus-menerus.

### Phase 2 - Telegram Command Interface

Target: user bisa cek dan kontrol bot dari Telegram.

Checklist:

- Buat module command handler, misalnya `src/commands.js`.
- Tambahkan long polling `getUpdates` yang berjalan paralel dengan scanner.
- Simpan `lastUpdateId` di state.
- Tambahkan admin allowlist.
- Implement `/start`, `/help`, `/status`, `/performance`, `/open`, `/symbols`.
- Implement `/pause`, `/resume`, dan `/scanonce`.
- Tambahkan response untuk command tidak dikenal.
- Dokumentasikan command di README.

Kriteria selesai:

- Command dari admin diproses.
- Command dari non-admin ditolak.
- Scanner bisa dipause dan diresume tanpa restart.
- Status bot bisa dilihat dari Telegram.

### Phase 3 - Signal Lifecycle Tracking

Target: setiap trade punya perjalanan yang lengkap.

Checklist:

- Ubah struktur open trade agar menyimpan status TP1/TP2/TP3.
- Update outcome checker agar mendeteksi TP1, TP2, TP3, dan SL.
- Kirim notifikasi saat TP/SL tersentuh.
- Tambahkan konservatisme saat TP dan SL tersentuh dalam candle yang sama.
- Tambahkan R-multiple dan estimasi PnL per event.
- Update weekly/monthly report agar menampilkan average R dan TP hit rate.
- Tambahkan migration untuk trade lama yang hanya punya `tp2`.

Kriteria selesai:

- Trade tidak hanya selesai di TP2/SL.
- User menerima update saat TP1/TP2/TP3/SL terjadi.
- Performance report lebih informatif dari sekadar winrate.

### Phase 4 - Backtesting Engine

Target: strategi bisa diuji secara historis.

Checklist:

- Buat script `src/backtest.js` atau folder `scripts/backtest.js`.
- Ambil candle historis dari CCXT dengan pagination jika diperlukan.
- Jalankan strategy pada candle tertutup secara iteratif.
- Simulasikan trade lifecycle berdasarkan OHLC.
- Tambahkan output summary di console.
- Tambahkan export JSON/CSV.
- Tambahkan script npm, misalnya `npm run backtest`.
- Dokumentasikan contoh penggunaan.

Kriteria selesai:

- Backtest bisa dijalankan untuk minimal satu symbol dan timeframe.
- Hasil menampilkan total trade, winrate, average R, max drawdown, dan profit factor.
- Hasil bisa diekspor untuk analisis lanjutan.

### Phase 5 - Paper Trading Mode

Target: strategi bisa diuji live tanpa order real.

Checklist:

- Tambahkan env `PAPER_TRADING_ENABLED`.
- Simpan semua sinyal sebagai paper trade.
- Hitung outcome menggunakan candle live berikutnya.
- Tambahkan fee dan slippage optional.
- Tambahkan report harian atau mingguan khusus paper trading.
- Tambahkan command `/paper` untuk ringkasan paper trading.

Kriteria selesai:

- Paper trade berjalan tanpa mengganggu alert utama.
- Hasil paper trading bisa dibandingkan dengan backtest.
- User bisa melihat performa paper trading dari Telegram.

### Phase 6 - Strategy Profiles dan Multi-Timeframe

Target: strategi lebih fleksibel dan lebih mudah dituning.

Checklist:

- Tambahkan config strategy profile.
- Tambahkan per-symbol config override.
- Tambahkan fetch candle untuk higher timeframe.
- Tambahkan filter trend HTF.
- Tambahkan cooldown sinyal per symbol.
- Tambahkan debug output agar alasan sinyal ditolak lebih jelas.

Kriteria selesai:

- Symbol berbeda bisa memakai parameter berbeda.
- Sinyal bisa difilter dengan trend timeframe lebih tinggi.
- User bisa tuning strategi tanpa mengubah kode.

### Phase 7 - Observability dan Dashboard

Target: monitoring production lebih nyaman.

Checklist:

- Tambahkan healthcheck HTTP server optional.
- Tambahkan heartbeat Telegram harian atau per beberapa jam.
- Tambahkan last scan success/failure di state.
- Tambahkan structured logs.
- Tambahkan dashboard ringan jika diperlukan.
- Evaluasi Telegram Mini App jika dashboard web mulai kompleks.

Kriteria selesai:

- User tahu bot masih hidup tanpa cek log manual.
- Deployment platform bisa melakukan healthcheck.
- Riwayat scan dan error mudah dilacak.

## 5. Urutan Eksekusi yang Direkomendasikan

Urutan paling pragmatis:

1. Phase 1 - Fondasi Reliability.
2. Phase 2 - Telegram Command Interface.
3. Phase 3 - Signal Lifecycle Tracking.
4. Phase 4 - Backtesting Engine.
5. Phase 5 - Paper Trading Mode.
6. Phase 6 - Strategy Profiles dan Multi-Timeframe.
7. Phase 7 - Observability dan Dashboard.

Alasan urutan ini:

- Reliability harus lebih dulu karena fitur lain bergantung pada state yang aman.
- Command Telegram membuat operasional harian jauh lebih mudah.
- Lifecycle tracking membuat data performa lebih akurat.
- Backtesting dan paper trading butuh lifecycle yang sudah matang.
- Strategy upgrade lebih aman dilakukan setelah punya data evaluasi.
- Dashboard sebaiknya dibuat setelah model data dan workflow stabil.

## 6. Risiko Teknis

- Database migration bisa merusak state jika tidak ada backup.
- Long polling Telegram harus disinkronkan agar tidak mengganggu scanner.
- Backtest berbasis OHLC tidak tahu urutan intrabar, jadi perlu aturan konservatif.
- Multi-timeframe fetch menambah beban request exchange.
- Per-symbol config bisa membuat konfigurasi makin kompleks jika tidak didokumentasikan dengan baik.
- Jika nanti menambah eksekusi order real, risiko keamanan dan finansial meningkat besar. Untuk saat ini bot sebaiknya tetap alert-only.

## 7. Prinsip Implementasi

- Pertahankan backward compatibility untuk `state.json` yang sudah ada.
- Default lokal harus tetap sederhana.
- Fitur production seperti database dibuat optional via env.
- Jangan membuat bot melakukan order real tanpa desain keamanan terpisah.
- Semua perubahan besar harus punya dokumentasi env dan contoh penggunaan.
- Tambahkan test untuk logic yang memengaruhi sinyal, state, dan outcome trade.

## 8. Definition of Done Umum

Setiap fase dianggap selesai jika:

- Kode lulus `npm run check`.
- Fitur terdokumentasi di README atau dokumen terkait.
- Default behavior lama tetap berjalan jika env baru tidak diisi.
- Error utama sudah ditangani dengan pesan yang jelas.
- Perubahan state memiliki migration atau fallback aman.
