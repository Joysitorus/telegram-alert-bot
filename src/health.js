import http from "http";
import { getPerformanceState, getRuntimeState } from "./state.js";

function escapeHtml(text = "") {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function buildDashboardSnapshot(state) {
  const runtime = getRuntimeState(state);
  const performance = getPerformanceState(state);
  const closedTrades = performance.closedTrades.slice(-50).reverse();

  return {
    runtime,
    paperAccount: performance.paperAccount,
    openTrades: performance.openTrades,
    closedTrades,
    paperTrades: performance.paperTrades.slice(-50).reverse(),
    totals: {
      open: performance.openTrades.length,
      closed: performance.closedTrades.length,
      paper: performance.paperTrades.length
    }
  };
}

function buildPrometheusMetrics(state) {
  const snapshot = buildDashboardSnapshot(state);
  const account = snapshot.paperAccount || {};
  const rejected = Number(account.rejectedTrades) || 0;
  const lines = [
    "# HELP crypto_bot_open_trades Number of open alert trades.",
    "# TYPE crypto_bot_open_trades gauge",
    `crypto_bot_open_trades ${snapshot.totals.open}`,
    "# HELP crypto_bot_paper_trades Number of paper trades.",
    "# TYPE crypto_bot_paper_trades gauge",
    `crypto_bot_paper_trades ${snapshot.totals.paper}`,
    "# HELP crypto_bot_paper_balance Paper account balance in USDT.",
    "# TYPE crypto_bot_paper_balance gauge",
    `crypto_bot_paper_balance ${Number(account.balance) || 0}`,
    "# HELP crypto_bot_paper_used_margin Paper account used margin in USDT.",
    "# TYPE crypto_bot_paper_used_margin gauge",
    `crypto_bot_paper_used_margin ${Number(account.usedMargin) || 0}`,
    "# HELP crypto_bot_paper_liquidations_total Total paper liquidations.",
    "# TYPE crypto_bot_paper_liquidations_total counter",
    `crypto_bot_paper_liquidations_total ${Number(account.totalLiquidations) || 0}`,
    "# HELP crypto_bot_paper_rejected_trades_total Total rejected paper trades.",
    "# TYPE crypto_bot_paper_rejected_trades_total counter",
    `crypto_bot_paper_rejected_trades_total ${rejected}`,
    "# HELP crypto_bot_last_scan_success_timestamp Last successful scan timestamp in milliseconds.",
    "# TYPE crypto_bot_last_scan_success_timestamp gauge",
    `crypto_bot_last_scan_success_timestamp ${Number(snapshot.runtime.lastScanSuccessAt) || 0}`
  ];
  return `${lines.join("\n")}\n`;
}

function tradeRow(trade) {
  return `
    <tr>
      <td>${escapeHtml(trade.status || trade.outcome || "OPEN")}</td>
      <td>${escapeHtml(trade.symbol)}</td>
      <td>${escapeHtml(trade.direction)}</td>
      <td>${escapeHtml(trade.timeframe)}</td>
      <td>${escapeHtml(trade.entry)}</td>
      <td>${escapeHtml(trade.exit || "-")}</td>
      <td>${escapeHtml(trade.realizedR ?? "-")}</td>
      <td>${escapeHtml(trade.openedAt ? new Date(trade.openedAt).toISOString() : "-")}</td>
    </tr>
  `;
}

function buildEquitySvg(points = []) {
  const data = points.slice(-80);
  if (data.length < 2) return `<div class="empty-chart">No equity data</div>`;
  const width = 760;
  const height = 160;
  const balances = data.map((point) => Number(point.balance) || 0);
  const min = Math.min(...balances);
  const max = Math.max(...balances);
  const span = max - min || 1;
  const path = data.map((point, index) => {
    const x = index / (data.length - 1) * width;
    const y = height - ((Number(point.balance) || 0) - min) / span * height;
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img"><path d="${path}" fill="none" stroke="#1f7a5a" stroke-width="3"/></svg>`;
}

function buildDashboardHtml(state, status) {
  const snapshot = buildDashboardSnapshot(state);
  const openRows = snapshot.openTrades.map(tradeRow).join("") || `<tr><td colspan="8">No open trades</td></tr>`;
  const closedRows = snapshot.closedTrades.map(tradeRow).join("") || `<tr><td colspan="8">No closed trades</td></tr>`;
  const rejectedRows = (state.research?.signalDecisions || []).filter((item) => !item.accepted).slice(-20).reverse()
    .map((item) => `<tr><td>${escapeHtml(item.symbol || "-")}</td><td>${escapeHtml(item.reason || "-")}</td><td>${escapeHtml(new Date(item.at).toISOString())}</td></tr>`)
    .join("") || `<tr><td colspan="3">No rejected decisions</td></tr>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Crypto Alert Bot Dashboard</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; color: #172026; background: #f5f7f8; }
    header { background: #172026; color: white; padding: 20px 24px; }
    main { max-width: 1180px; margin: 0 auto; padding: 20px; }
    h1 { margin: 0 0 6px; font-size: 24px; }
    h2 { margin: 28px 0 10px; font-size: 18px; }
    .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-top: 16px; }
    .metric { background: white; border: 1px solid #dde3e6; border-radius: 6px; padding: 14px; }
    .metric span { display: block; color: #64727a; font-size: 12px; }
    .metric strong { display: block; margin-top: 6px; font-size: 20px; }
    table { width: 100%; border-collapse: collapse; background: white; border: 1px solid #dde3e6; }
    th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid #e7ecef; font-size: 13px; }
    th { color: #42515a; background: #eef2f4; }
    .table-wrap { overflow-x: auto; }
    .chart-wrap { background: white; border: 1px solid #dde3e6; padding: 12px; }
    .chart { width: 100%; height: 180px; display: block; }
    .empty-chart { color: #64727a; background: white; border: 1px solid #dde3e6; padding: 24px; }
  </style>
</head>
<body>
  <header>
    <h1>Crypto Alert Bot Dashboard</h1>
    <div>Status: ${escapeHtml(status)} | Last success: ${escapeHtml(snapshot.runtime.lastScanSuccessAt ? new Date(snapshot.runtime.lastScanSuccessAt).toISOString() : "-")}</div>
  </header>
  <main>
    <section class="metrics">
      <div class="metric"><span>Scanner</span><strong>${snapshot.runtime.paused ? "Paused" : "Running"}</strong></div>
      <div class="metric"><span>Open Trades</span><strong>${snapshot.totals.open}</strong></div>
      <div class="metric"><span>Closed Trades</span><strong>${snapshot.totals.closed}</strong></div>
      <div class="metric"><span>Paper Trades</span><strong>${snapshot.totals.paper}</strong></div>
      <div class="metric"><span>Paper Balance</span><strong>${escapeHtml(snapshot.paperAccount?.balance ?? "-")}</strong></div>
      <div class="metric"><span>Used Margin</span><strong>${escapeHtml(snapshot.paperAccount?.usedMargin ?? "-")}</strong></div>
    </section>
    <h2>Open Trades</h2>
    <div class="table-wrap"><table><thead><tr><th>Status</th><th>Symbol</th><th>Side</th><th>TF</th><th>Entry</th><th>Exit</th><th>R</th><th>Opened</th></tr></thead><tbody>${openRows}</tbody></table></div>
    <h2>Paper Equity Curve</h2>
    <div class="chart-wrap">${buildEquitySvg(snapshot.paperAccount?.equityCurve || [])}</div>
    <h2>Recent Closed Trades</h2>
    <div class="table-wrap"><table><thead><tr><th>Status</th><th>Symbol</th><th>Side</th><th>TF</th><th>Entry</th><th>Exit</th><th>R</th><th>Opened</th></tr></thead><tbody>${closedRows}</tbody></table></div>
    <h2>Recent Rejected Decisions</h2>
    <div class="table-wrap"><table><thead><tr><th>Symbol</th><th>Reason</th><th>Time</th></tr></thead><tbody>${rejectedRows}</tbody></table></div>
  </main>
</body>
</html>`;
}

export function startHealthServer({ config, state, getStatus }) {
  if (!config.runtime.healthcheckEnabled && !config.runtime.dashboardEnabled) return null;

  const server = http.createServer((req, res) => {
    if (config.runtime.dashboardEnabled && (req.url === "/" || req.url === "/dashboard")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(buildDashboardHtml(state, getStatus()));
      return;
    }

    if (config.runtime.dashboardEnabled && req.url === "/dashboard.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(buildDashboardSnapshot(state)));
      return;
    }

    if (req.url === "/metrics") {
      res.writeHead(200, { "content-type": "text/plain; version=0.0.4; charset=utf-8" });
      res.end(buildPrometheusMetrics(state));
      return;
    }

    if (!config.runtime.healthcheckEnabled || (req.url !== "/health" && req.url !== "/")) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "not_found" }));
      return;
    }

    const runtime = getRuntimeState(state);
    const body = {
      ok: true,
      status: getStatus(),
      paused: runtime.paused,
      lastScanAt: runtime.lastScanAt,
      lastScanSuccessAt: runtime.lastScanSuccessAt,
      lastScanSuccessAgeSeconds: runtime.lastScanSuccessAt ? Math.round((Date.now() - runtime.lastScanSuccessAt) / 1000) : null,
      lastScanErrorAt: runtime.lastScanErrorAt,
      lastScanError: runtime.lastScanError
    };

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });

  server.listen(config.runtime.healthcheckPort);
  return server;
}
