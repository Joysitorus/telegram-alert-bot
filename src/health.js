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
  const marketSnapshots = (state.research?.marketSnapshots || []).slice(-160);
  const orderBookSnapshots = (state.research?.orderBookSnapshots || []).slice(-80);
  const signalDecisions = state.research?.signalDecisions || [];

  return {
    runtime,
    paperAccount: performance.paperAccount,
    openTrades: performance.openTrades,
    closedTrades,
    paperTrades: performance.paperTrades.slice(-50).reverse(),
    marketSnapshots,
    orderBookSnapshots,
    signalDecisions: signalDecisions.slice(-80),
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

function statusClass(value = "") {
  const text = String(value).toUpperCase();
  if (text.includes("SL") || text.includes("LIQUIDATED") || text.includes("REJECT")) return "danger";
  if (text.includes("TP") || text.includes("RUNNING")) return "success";
  if (text.includes("PAUSED") || text.includes("EXPIRED")) return "warn";
  return "neutral";
}

function sideClass(value = "") {
  return String(value).toUpperCase() === "BUY" ? "buy" : String(value).toUpperCase() === "SELL" ? "sell" : "neutral";
}

function tradeRow(trade) {
  const status = trade.status || trade.outcome || "OPEN";
  const side = trade.direction || "-";
  return `
    <tr>
      <td><span class="badge ${statusClass(status)}">${escapeHtml(status)}</span></td>
      <td>${escapeHtml(trade.symbol)}</td>
      <td><span class="side ${sideClass(side)}">${escapeHtml(side)}</span></td>
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
  return `
    <svg class="chart" viewBox="0 0 ${width} ${height}" role="img">
      <defs>
        <linearGradient id="equityLine" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stop-color="#5eead4"/>
          <stop offset="55%" stop-color="#facc15"/>
          <stop offset="100%" stop-color="#38bdf8"/>
        </linearGradient>
      </defs>
      <path class="chart-grid" d="M0,40 H760 M0,80 H760 M0,120 H760"/>
      <path d="${path}" fill="none" stroke="url(#equityLine)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;
}

function buildPriceSvg(points = [], decisions = []) {
  const data = points.slice(-120);
  if (data.length < 2) return `<div class="empty-chart">No candle data</div>`;

  const width = 960;
  const height = 240;
  const closes = data.map((point) => Number(point.close) || 0);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const firstTime = Number(data[0].candleTime);
  const lastTime = Number(data.at(-1).candleTime);
  const timeSpan = Math.max(1, lastTime - firstTime);
  const xForTime = (timestamp) => (Number(timestamp) - firstTime) / timeSpan * width;
  const yForPrice = (price) => height - ((Number(price) || 0) - min) / span * height;
  const path = data.map((point, index) => {
    const x = index / (data.length - 1) * width;
    const y = yForPrice(point.close);
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  const markers = decisions
    .filter((decision) => decision.accepted && decision.direction && decision.debug?.lastCandleTime >= firstTime)
    .slice(-20)
    .map((decision) => {
      const candle = data.find((point) => point.candleTime === decision.debug?.lastCandleTime) || data.at(-1);
      const x = Math.max(0, Math.min(width, xForTime(decision.debug?.lastCandleTime || candle.candleTime)));
      const y = Math.max(10, Math.min(height - 10, yForPrice(decision.debug?.close || candle.close)));
      const cls = decision.direction === "BUY" ? "marker-buy" : "marker-sell";
      return `<circle class="${cls}" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="6"><title>${escapeHtml(decision.symbol)} ${escapeHtml(decision.direction)}</title></circle>`;
    })
    .join("");

  return `
    <svg class="chart price-chart" viewBox="0 0 ${width} ${height}" role="img">
      <defs>
        <linearGradient id="priceLine" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stop-color="#38bdf8"/>
          <stop offset="60%" stop-color="#5eead4"/>
          <stop offset="100%" stop-color="#facc15"/>
        </linearGradient>
      </defs>
      <path class="chart-grid" d="M0,60 H960 M0,120 H960 M0,180 H960"/>
      <path d="${path}" fill="none" stroke="url(#priceLine)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
      ${markers}
    </svg>
  `;
}

function orderBookRow(snapshot) {
  const bid = snapshot.nearestBidWall;
  const ask = snapshot.nearestAskWall;
  return `
    <tr>
      <td>${escapeHtml(snapshot.symbol || "-")}</td>
      <td>${escapeHtml(snapshot.midPrice ?? "-")}</td>
      <td>${escapeHtml(snapshot.spreadPercent?.toFixed ? snapshot.spreadPercent.toFixed(4) : snapshot.spreadPercent ?? "-")}%</td>
      <td>${bid ? `<span class="badge success">${escapeHtml(bid.price)} / ${escapeHtml(Math.round(bid.notional))}</span>` : "-"}</td>
      <td>${ask ? `<span class="badge danger">${escapeHtml(ask.price)} / ${escapeHtml(Math.round(ask.notional))}</span>` : "-"}</td>
      <td>${escapeHtml(snapshot.at ? new Date(snapshot.at).toISOString() : "-")}</td>
    </tr>
  `;
}

function buildDashboardHtml(state, status) {
  const snapshot = buildDashboardSnapshot(state);
  const openRows = snapshot.openTrades.map(tradeRow).join("") || `<tr><td colspan="8">No open trades</td></tr>`;
  const closedRows = snapshot.closedTrades.map(tradeRow).join("") || `<tr><td colspan="8">No closed trades</td></tr>`;
  const rejectedRows = (state.research?.signalDecisions || []).filter((item) => !item.accepted).slice(-20).reverse()
    .map((item) => `<tr><td>${escapeHtml(item.symbol || "-")}</td><td><span class="badge danger">${escapeHtml(item.reason || "-")}</span></td><td>${escapeHtml(new Date(item.at).toISOString())}</td></tr>`)
    .join("") || `<tr><td colspan="3">No rejected decisions</td></tr>`;
  const orderBookRows = snapshot.orderBookSnapshots.slice(-20).reverse().map(orderBookRow).join("") || `<tr><td colspan="6">No order book liquidity data</td></tr>`;
  const scannerStatus = snapshot.runtime.paused ? "Paused" : "Running";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Crypto Alert Bot Dashboard</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #070a0f;
      --surface: rgba(16, 24, 34, 0.72);
      --surface-strong: rgba(18, 28, 40, 0.9);
      --border: rgba(148, 163, 184, 0.22);
      --text: #edf5f2;
      --muted: #93a4b5;
      --faint: #64748b;
      --cyan: #5eead4;
      --blue: #38bdf8;
      --amber: #facc15;
      --red: #fb7185;
      --green: #86efac;
      --shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-width: 320px;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--text);
      background:
        linear-gradient(135deg, rgba(94, 234, 212, 0.11), transparent 32%),
        linear-gradient(315deg, rgba(250, 204, 21, 0.08), transparent 28%),
        var(--bg);
    }
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      background-image:
        linear-gradient(rgba(148, 163, 184, 0.06) 1px, transparent 1px),
        linear-gradient(90deg, rgba(148, 163, 184, 0.06) 1px, transparent 1px);
      background-size: 44px 44px;
      mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.9), transparent 82%);
    }
    header {
      border-bottom: 1px solid var(--border);
      background: rgba(7, 10, 15, 0.72);
      backdrop-filter: blur(18px);
      position: sticky;
      top: 0;
      z-index: 2;
    }
    .topbar {
      max-width: 1240px;
      margin: 0 auto;
      padding: 22px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    h1 { margin: 0; font-size: clamp(22px, 3vw, 34px); line-height: 1.05; letter-spacing: 0; }
    .subtitle { margin-top: 8px; color: var(--muted); font-size: 14px; }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: rgba(15, 23, 42, 0.72);
      color: var(--text);
      white-space: nowrap;
      box-shadow: var(--shadow);
    }
    .dot { width: 8px; height: 8px; border-radius: 999px; background: var(--green); box-shadow: 0 0 18px var(--green); }
    .dot.paused { background: var(--amber); box-shadow: 0 0 18px var(--amber); }
    main { max-width: 1240px; margin: 0 auto; padding: 22px 20px 40px; position: relative; }
    h2 { margin: 30px 0 12px; font-size: 16px; line-height: 1.2; letter-spacing: 0; color: #d8e7e4; }
    .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; }
    .metric {
      min-height: 102px;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.035));
      backdrop-filter: blur(18px);
      box-shadow: var(--shadow);
    }
    .metric span { display: block; color: var(--muted); font-size: 12px; text-transform: uppercase; }
    .metric strong {
      display: block;
      margin-top: 10px;
      font-size: clamp(20px, 4vw, 30px);
      line-height: 1.05;
      overflow-wrap: anywhere;
    }
    .table-wrap, .chart-wrap {
      overflow-x: auto;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
      backdrop-filter: blur(18px);
      box-shadow: var(--shadow);
    }
    table { width: 100%; min-width: 820px; border-collapse: collapse; }
    th, td { text-align: left; padding: 12px 14px; border-bottom: 1px solid rgba(148, 163, 184, 0.14); font-size: 13px; vertical-align: middle; }
    th { color: #c8d7d4; background: rgba(15, 23, 42, 0.68); font-size: 12px; text-transform: uppercase; position: sticky; top: 0; }
    td { color: #e5eef0; }
    tr:last-child td { border-bottom: 0; }
    tr:hover td { background: rgba(255, 255, 255, 0.035); }
    .badge, .side {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 4px 8px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      white-space: nowrap;
      border: 1px solid currentColor;
    }
    .success, .buy { color: var(--green); background: rgba(34, 197, 94, 0.12); }
    .danger, .sell { color: var(--red); background: rgba(244, 63, 94, 0.12); }
    .warn { color: var(--amber); background: rgba(250, 204, 21, 0.12); }
    .neutral { color: var(--blue); background: rgba(56, 189, 248, 0.12); }
    .chart-wrap { padding: 18px; }
    .chart { width: 100%; height: 220px; display: block; }
    .chart-grid { fill: none; stroke: rgba(148, 163, 184, 0.16); stroke-width: 1; }
    .marker-buy { fill: var(--green); stroke: rgba(7, 10, 15, 0.85); stroke-width: 3; }
    .marker-sell { fill: var(--red); stroke: rgba(7, 10, 15, 0.85); stroke-width: 3; }
    .empty-chart {
      min-height: 160px;
      display: grid;
      place-items: center;
      color: var(--muted);
      border: 1px dashed rgba(148, 163, 184, 0.28);
      border-radius: 8px;
      background: rgba(15, 23, 42, 0.38);
    }
    @media (max-width: 720px) {
      .topbar { align-items: flex-start; flex-direction: column; padding: 18px 14px; }
      main { padding: 16px 14px 30px; }
      .metrics { grid-template-columns: 1fr 1fr; }
      .metric { min-height: 94px; padding: 13px; }
      h2 { margin-top: 24px; }
    }
    @media (max-width: 460px) {
      .metrics { grid-template-columns: 1fr; }
      .status-pill { width: 100%; justify-content: center; }
    }
  </style>
</head>
<body>
  <header>
    <div class="topbar">
      <div>
        <h1>Crypto Alert Bot Dashboard</h1>
        <div class="subtitle">Status: ${escapeHtml(status)} | Last success: ${escapeHtml(snapshot.runtime.lastScanSuccessAt ? new Date(snapshot.runtime.lastScanSuccessAt).toISOString() : "-")}</div>
      </div>
      <div class="status-pill"><span class="dot ${snapshot.runtime.paused ? "paused" : ""}"></span>${escapeHtml(scannerStatus)}</div>
    </div>
  </header>
  <main>
    <section class="metrics">
      <div class="metric"><span>Scanner</span><strong>${escapeHtml(scannerStatus)}</strong></div>
      <div class="metric"><span>Open Trades</span><strong>${snapshot.totals.open}</strong></div>
      <div class="metric"><span>Closed Trades</span><strong>${snapshot.totals.closed}</strong></div>
      <div class="metric"><span>Paper Trades</span><strong>${snapshot.totals.paper}</strong></div>
      <div class="metric"><span>Paper Balance</span><strong>${escapeHtml(snapshot.paperAccount?.balance ?? "-")}</strong></div>
      <div class="metric"><span>Used Margin</span><strong>${escapeHtml(snapshot.paperAccount?.usedMargin ?? "-")}</strong></div>
    </section>
    <h2>Open Trades</h2>
    <div class="table-wrap"><table><thead><tr><th>Status</th><th>Symbol</th><th>Side</th><th>TF</th><th>Entry</th><th>Exit</th><th>R</th><th>Opened</th></tr></thead><tbody>${openRows}</tbody></table></div>
    <h2>Recent Candle Close</h2>
    <div class="chart-wrap">${buildPriceSvg(snapshot.marketSnapshots, snapshot.signalDecisions)}</div>
    <h2>Order Book Liquidity Walls</h2>
    <div class="table-wrap"><table><thead><tr><th>Symbol</th><th>Mid</th><th>Spread</th><th>Nearest Bid Wall</th><th>Nearest Ask Wall</th><th>Time</th></tr></thead><tbody>${orderBookRows}</tbody></table></div>
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
