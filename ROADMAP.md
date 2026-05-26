# Roadmap Telegram Crypto Alert Bot

Roadmap ini adalah roadmap terbaru setelah baseline alert bot, paper trading, risk engine, signal-quality filter, replay, dashboard, Telegram control panel, metrics, dan deployment hardening selesai secara fungsional.

Tujuan roadmap baru: menaikkan kualitas evaluasi strategi, akurasi simulasi futures, ketahanan production, dan kesiapan produk jika nanti ingin bergerak dari alert-only ke decision-support yang lebih serius. Bot tetap **alert-only dan paper-trading** sampai ada desain keamanan terpisah untuk real order execution.

## 1. Status Baseline Saat Ini

Sudah tersedia:

- Scanner multi-symbol berbasis CCXT OHLCV.
- Strategi teknikal EMA, RSI, MACD, ADX, volume, breakout, order block, smart liquidity, market regime, higher timeframe, funding, open interest, dan long/short ratio.
- Signal-quality filter: entry mode, breakout ATR, extension ATR, candle body/wick/volume, fallback liquidity reject.
- Trade lifecycle: TP1/TP2/TP3/SL/EXPIRED, partial exit, fee/slippage, break-even after TP1, trailing after TP2.
- Paper trading futures-style: initial balance, notional, leverage, margin, liquidation, daily loss limit, drawdown kill switch, risk mode, max notional/margin.
- State schema version, migration backup, file/PostgreSQL storage, file lock, PostgreSQL advisory lock.
- Telegram commands, role admin/operator/viewer, inline keyboard, risk/equity/drawdown/rejected/why/backup commands.
- Dashboard HTML, equity curve, rejected decisions table, `/health`, `/metrics`.
- Replay baseline via `npm run replay`.
- Tests via `npm test`.
- Railway deployment config.

Baseline verifikasi:

- `npm run check` wajib lolos.
- `npm test` wajib lolos.
- Default behavior tetap aman jika env baru tidak diisi.

## 2. Prinsip Roadmap Baru

- Data internal menjadi sumber keputusan tuning, bukan impresi dari alert Telegram.
- Strategi tidak boleh dianggap bagus sebelum lolos replay, paper forward-test, dan review drawdown.
- Leverage tinggi hanya boleh dipakai jika liquidation distance valid terhadap SL.
- Setiap fitur baru harus menyimpan reason code agar bisa diaudit.
- Real order execution tidak dikerjakan sebelum ada security model, audit, emergency stop, dan dry-run yang matang.

## 3. P0 - Validation dan Test Coverage

Fokus: memastikan engine yang sudah kompleks tidak salah hitung.

Checklist:

- Tambah test untuk semua outcome lifecycle:
  - TP1 lalu SL.
  - TP1/TP2 lalu SL.
  - TP1/TP2/TP3.
  - EXPIRED.
  - LIQUIDATED.
  - TP dan SL dalam candle yang sama.
- Tambah test untuk short trade, bukan hanya long.
- Tambah test untuk fee, slippage, margin release, break-even, trailing stop.
- Tambah test untuk config validation.
- Tambah test untuk command role:
  - viewer tidak bisa pause/resume/setpaper.
  - operator bisa command kontrol.
  - owner bisa semua command.
- Tambah test untuk signal-quality filter:
  - breakout ATR terlalu kecil ditolak.
  - wick terlalu besar ditolak.
  - fallback liquidity reject bekerja.
- Tambah test untuk replay deterministic dengan fixture candle lokal.

Kriteria selesai:

- Coverage logic kritis lifecycle/risk/strategy/commands minimal cukup untuk mencegah regresi fatal.
- `npm test` menjadi gate wajib sebelum deploy.

## 4. P1 - Exchange-Specific Futures Accuracy

Fokus: paper trading makin mendekati kondisi exchange futures nyata.

Checklist:

- Tambah exchange profile:
  - Bitget USDT swap.
  - Binance USD-M futures.
  - Bybit USDT perpetual.
- Tambah maintenance margin tiers per exchange secara configurable.
- Tambah mark-price mode jika exchange menyediakan data.
- Tambah funding cost accrual:
  - funding interval.
  - estimated funding paid/received.
  - total funding cost per trade.
- Tambah taker/maker fee profile per exchange.
- Tambah liquidation formula per exchange profile.
- Tambah risk label:
  - `SAFE`.
  - `TIGHT`.
  - `DANGEROUS`.
  - `INVALID`.
- Tambah command `/liq` untuk open paper positions.

Kriteria selesai:

- Paper liquidation tidak lagi formula generic saja.
- Report paper mencantumkan fee, slippage, funding, margin, dan liquidation distance.

## 5. P2 - Research Data Warehouse

Fokus: dataset internal yang rapi untuk evaluasi strategi.

Checklist:

- Buat storage tabel/struktur untuk:
  - candles.
  - features.
  - signal decisions.
  - paper trade events.
  - equity curve.
  - rejected reason counts.
- PostgreSQL schema terpisah dari `bot_state`.
- Retention policy:
  - raw candle retention.
  - signal decision retention.
  - paper trade retention.
- Export command:
  - `/export paper`.
  - `/export decisions`.
  - `/export equity`.
- Export file CSV/JSON lokal via script.
- Tambah `npm run export`.
- Tambah `npm run ingest` untuk mengisi data candle historis.

Kriteria selesai:

- Dataset bisa dianalisis di luar bot.
- Replay tidak hanya bergantung pada fetch exchange live.
- Setiap tuning parameter punya bukti historis.

## 6. P3 - Strategy Lab dan Walk-Forward

Fokus: membandingkan konfigurasi strategi secara terukur.

Checklist:

- Tambah `npm run walkforward`.
- Tambah config experiment file, misalnya `experiments/*.json`.
- Parameter sweep:
  - `ENTRY_MODE`.
  - `MIN_CONFIRM`.
  - `MIN_RR`.
  - `SAFE_SL_BUFFER_ATR`.
  - `MIN_BREAKOUT_ATR`.
  - HTF on/off.
  - market regime filter.
- Walk-forward split:
  - train window.
  - validation window.
  - out-of-sample window.
- Metrics:
  - total trades.
  - winrate.
  - expectancy.
  - average R.
  - average PnL USDT.
  - max drawdown.
  - liquidation rate.
  - profit factor.
  - exposure time.
  - rejected reason distribution.
- Ranking hasil experiment.
- Config hash dan strategy version pada setiap result.

Kriteria selesai:

- Perubahan strategi tidak dipromosikan ke default tanpa hasil walk-forward.
- Hasil experiment bisa dibandingkan antar symbol/timeframe.

## 7. P4 - Strategy Modularization v2

Fokus: strategi tidak monolitik dan mudah dieksperimenkan.

Checklist:

- Pisahkan module:
  - `features/`
  - `filters/`
  - `entries/`
  - `exits/`
  - `risk/`
  - `scoring/`
- Strategy registry:
  - `breakout_v1`.
  - `breakout_retest_v1`.
  - `pullback_trend_v1`.
  - `liquidity_sweep_v1`.
  - `funding_contrarian_v1`.
- Weighted scoring dan confidence:
  - `LOW`.
  - `MEDIUM`.
  - `HIGH`.
- Per-symbol strategy assignment dari config.
- Strategy comparison report.

Kriteria selesai:

- Menambah strategi baru tidak perlu mengubah scanner utama.
- Replay/paper/live alert memakai interface strategi yang sama.

## 8. P5 - Advanced Signal Quality

Fokus: mengurangi sinyal yang langsung kena SL.

Checklist:

- Retest state machine:
  - breakout detected.
  - retest pending.
  - retest confirmed.
  - invalidated.
- Liquidity sweep detection:
  - sweep previous high/low.
  - close back inside range.
  - reversal confirmation.
- Market structure:
  - higher high/higher low.
  - lower high/lower low.
  - break of structure.
  - change of character.
- Volatility regime:
  - ATR percentile.
  - range expansion/contraction.
  - session volatility.
- Volume quality:
  - volume z-score.
  - volume trend.
  - abnormal wick rejection.
- Symbol universe filter:
  - minimum volume.
  - maximum spread proxy.
  - minimum candle quality.

Kriteria selesai:

- Bot bisa memilih antara breakout continuation, retest, pullback, dan reversal setup.
- Rejected reason cukup detail untuk evaluasi strategi.

## 9. P6 - Portfolio Risk dan Capital Allocation

Fokus: paper account tidak hanya mengevaluasi trade tunggal.

Checklist:

- Risk budget per symbol.
- Risk budget per strategy.
- Correlation group manual:
  - major.
  - meme.
  - AI.
  - L1.
  - DeFi.
- Max concurrent positions per group.
- Volatility-targeted notional sizing berbasis ATR percentile.
- Dynamic leverage cap dari:
  - SL distance.
  - liquidation distance.
  - volatility regime.
  - account drawdown.
- Equity protection:
  - reduce size after drawdown.
  - stop trading after losing streak.
  - resume rule after cooldown.

Kriteria selesai:

- Paper trading menunjukkan portfolio exposure, bukan hanya trade list.
- Risiko tidak terkonsentrasi pada symbol volatile yang berkorelasi.

## 10. P7 - Dashboard v2

Fokus: dashboard menjadi alat evaluasi, bukan hanya status page.

Checklist:

- Equity curve interaktif.
- Drawdown chart.
- Per-symbol performance table.
- Per-strategy performance table.
- Rejected reason heatmap.
- Open position liquidation distance.
- Paper account exposure.
- Funding/OI/long-short snapshot.
- Filter by date/symbol/strategy.
- Protected dashboard token optional.

Kriteria selesai:

- User bisa mengevaluasi strategi dari dashboard tanpa membaca state JSON.
- Dashboard aman jika dibuka di deployment publik.

## 11. P8 - Alert Quality dan Telegram UX

Fokus: alert lebih actionable dan command lebih cepat dipakai.

Checklist:

- Alert confidence label.
- Alert reason summary:
  - top confirmations.
  - top risks.
  - rejection of alternate side.
- Inline actions:
  - view risk.
  - view similar trades.
  - disable symbol.
  - pause paper.
- `/compare SYMBOL`.
- `/profile SYMBOL`.
- `/setprofile SYMBOL PROFILE`.
- `/experiment latest`.
- Telegram file export untuk CSV/JSON.
- Audit log command mutating lengkap.

Kriteria selesai:

- Telegram cukup untuk operasi harian tanpa dashboard.
- Semua perubahan runtime tercatat.

## 12. P9 - Production Operations

Fokus: bot stabil 24/7 dan mudah dipulihkan.

Checklist:

- External uptime monitor guide.
- Alert jika no successful scan > threshold.
- Alert jika state save gagal.
- Alert jika PostgreSQL lock gagal.
- Alert jika Telegram send gagal berulang.
- Automated state backup schedule.
- Restore guide.
- Railway deployment guide end-to-end.
- Environment checklist production.
- Runbook:
  - exchange down.
  - Telegram down.
  - state corrupt.
  - DB unavailable.
  - duplicate instance detected.

Kriteria selesai:

- Ada prosedur jelas untuk incident umum.
- Bot bisa dipulihkan tanpa menebak-nebak state.

## 13. P10 - Real Execution Readiness Gate

Fokus: hanya persiapan desain, belum implementasi order real.

Checklist:

- Threat model:
  - leaked token.
  - malicious command.
  - duplicate instance.
  - wrong symbol/market.
  - runaway order.
- Execution simulator:
  - order sizing.
  - reduce-only.
  - post-only/market.
  - partial fill.
  - rejected order.
- Required controls:
  - owner-only execution commands.
  - hard daily loss limit.
  - hard max notional.
  - exchange API key scope.
  - emergency stop.
  - dry-run mandatory.
- Paper-to-real comparison report.
- Manual approval checklist.

Kriteria selesai:

- Keputusan untuk real execution bisa dibuat berdasarkan dokumen risiko, bukan spontan.
- Tidak ada order real sampai gate ini selesai dan disetujui manual.

## 14. Urutan Eksekusi Direkomendasikan

1. P0 - Validation dan Test Coverage.
2. P1 - Exchange-Specific Futures Accuracy.
3. P2 - Research Data Warehouse.
4. P3 - Strategy Lab dan Walk-Forward.
5. P5 - Advanced Signal Quality.
6. P6 - Portfolio Risk dan Capital Allocation.
7. P4 - Strategy Modularization v2.
8. P7 - Dashboard v2.
9. P8 - Alert Quality dan Telegram UX.
10. P9 - Production Operations.
11. P10 - Real Execution Readiness Gate.

Alasan:

- Test dan exchange accuracy harus dulu karena semua evaluasi bergantung pada hitungan lifecycle yang benar.
- Dataset dan walk-forward harus mendahului tuning agresif.
- Strategy modularization lebih aman setelah eksperimen menunjukkan bentuk strategi yang layak.
- Real execution hanya boleh dibahas setelah paper system terbukti stabil.

## 15. Definition of Done

Setiap phase selesai jika:

- `npm run check` lolos.
- `npm test` lolos.
- README dan `.env.example` diperbarui.
- Default lama tetap aman.
- State migration aman.
- Ada reason code untuk keputusan baru.
- Ada minimal satu test atau replay fixture untuk logic kritis.
- Tidak ada fitur real order tanpa readiness gate.

## 16. Keputusan Produk Saat Ini

- Status produk: alert bot + paper trading + strategy research tool.
- Prioritas berikutnya: validation, exchange-specific accuracy, dataset, dan walk-forward.
- Real execution: tidak dikerjakan sampai P10 selesai.
