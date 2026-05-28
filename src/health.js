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

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatNumber(value, digits = 2) {
  const number = toNumber(value);
  if (number === null) return "-";
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: Math.min(digits, 2)
  }).format(number);
}

function formatCompact(value) {
  const number = toNumber(value);
  if (number === null) return "-";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2
  }).format(number);
}

function formatPrice(value) {
  const number = toNumber(value);
  if (number === null) return "-";
  const decimals = Math.abs(number) < 1 ? 8 : Math.abs(number) < 100 ? 4 : 2;
  return formatNumber(number, decimals);
}

function formatPercent(value, digits = 1) {
  const number = toNumber(value);
  if (number === null) return "-";
  return `${formatNumber(number, digits)}%`;
}

function formatR(value) {
  const number = toNumber(value);
  if (number === null) return "-";
  return `${formatNumber(number, 2)}R`;
}

function formatDate(value) {
  const timestamp = toNumber(value);
  if (!timestamp) return "-";
  return new Intl.DateTimeFormat("en-GB", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(timestamp));
}

function formatAge(value) {
  const timestamp = toNumber(value);
  if (!timestamp) return "-";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function getTradePnlClass(trade) {
  const r = toNumber(trade.realizedR);
  if (r === null || r === 0) return "neutral";
  return r > 0 ? "success" : "danger";
}

function buildTargetProgress(trade) {
  const hits = [
    ["TP1", Boolean(trade.tp1Hit)],
    ["TP2", Boolean(trade.tp2Hit)],
    ["TP3", Boolean(trade.tp3Hit)]
  ];
  return `<div class="target-progress">${hits.map(([label, hit]) => (
    `<span class="${hit ? "hit" : ""}">${label}</span>`
  )).join("")}</div>`;
}

function getDashboardStats(snapshot) {
  const account = snapshot.paperAccount || {};
  const paperTrades = snapshot.paperTrades || [];
  const paperClosed = paperTrades.filter((trade) => trade.outcome);
  const wins = paperClosed.filter((trade) => trade.outcome === "TP3" || trade.tp2Hit).length;
  const losses = paperClosed.filter((trade) => trade.outcome === "SL").length;
  const liquidations = paperClosed.filter((trade) => trade.outcome === "LIQUIDATED").length;
  const avgR = paperClosed.length
    ? paperClosed.reduce((sum, trade) => sum + (Number(trade.realizedR) || 0), 0) / paperClosed.length
    : 0;
  const rejected = (snapshot.signalDecisions || []).filter((decision) => !decision.accepted).length;
  const accepted = (snapshot.signalDecisions || []).filter((decision) => decision.accepted).length;
  const balance = Number(account.balance) || 0;
  const usedMargin = Number(account.usedMargin) || 0;
  const initialBalance = Number(account.initialBalance) || 0;
  const realizedPnl = Number(account.realizedPnl) || 0;
  const available = balance - usedMargin;
  const balanceChange = initialBalance > 0 ? (balance - initialBalance) / initialBalance * 100 : 0;
  const marginUsage = balance > 0 ? usedMargin / balance * 100 : 0;
  const symbols = new Set((snapshot.marketSnapshots || []).map((item) => item.symbol).filter(Boolean));

  return {
    accepted,
    rejected,
    wins,
    losses,
    liquidations,
    avgR,
    balance,
    usedMargin,
    available,
    realizedPnl,
    balanceChange,
    marginUsage,
    winRate: paperClosed.length ? wins / paperClosed.length * 100 : 0,
    paperClosed: paperClosed.length,
    activeSymbols: symbols.size
  };
}

function tradeRow(trade) {
  const status = trade.status || trade.outcome || "OPEN";
  const side = trade.direction || "-";
  return `
    <tr>
      <td><span class="badge ${statusClass(status)}">${escapeHtml(status)}</span></td>
      <td>${escapeHtml(trade.symbol)}</td>
      <td><span class="side ${sideClass(side)}">${escapeHtml(side)}</span></td>
      <td>${escapeHtml(formatPrice(trade.entry))}</td>
      <td>${escapeHtml(formatPrice(trade.sl))}</td>
      <td>${escapeHtml(formatPrice(trade.tp2))}</td>
      <td>${escapeHtml(formatPrice(trade.exit))}</td>
      <td>${buildTargetProgress(trade)}</td>
      <td><span class="badge ${getTradePnlClass(trade)}">${escapeHtml(formatR(trade.realizedR))}</span></td>
      <td>${escapeHtml(formatDate(trade.openedAt))}<span class="cell-muted">${escapeHtml(formatAge(trade.openedAt))}</span></td>
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
      <td>${escapeHtml(formatPrice(snapshot.midPrice))}</td>
      <td>${escapeHtml(formatPercent(snapshot.spreadPercent, 3))}</td>
      <td>${bid ? `<span class="liquidity buy">${escapeHtml(formatPrice(bid.price))}<small>${escapeHtml(formatCompact(bid.notional))}</small></span>` : "-"}</td>
      <td>${ask ? `<span class="liquidity sell">${escapeHtml(formatPrice(ask.price))}<small>${escapeHtml(formatCompact(ask.notional))}</small></span>` : "-"}</td>
      <td>${escapeHtml(formatDate(snapshot.at))}<span class="cell-muted">${escapeHtml(formatAge(snapshot.at))}</span></td>
    </tr>
  `;
}

function buildDashboardHtml(state, status) {
  const snapshot = buildDashboardSnapshot(state);
  const stats = getDashboardStats(snapshot);
  const openRows = snapshot.openTrades.map(tradeRow).join("") || `<tr><td colspan="10"><div class="empty-row">No open trades</div></td></tr>`;
  const closedRows = snapshot.closedTrades.map(tradeRow).join("") || `<tr><td colspan="10"><div class="empty-row">No closed trades</div></td></tr>`;
  const rejectedRows = (state.research?.signalDecisions || []).filter((item) => !item.accepted).slice(-20).reverse()
    .map((item) => `<tr><td>${escapeHtml(item.symbol || "-")}</td><td><span class="badge danger">${escapeHtml(item.reason || "-")}</span></td><td>${escapeHtml(formatDate(item.at))}<span class="cell-muted">${escapeHtml(formatAge(item.at))}</span></td></tr>`)
    .join("") || `<tr><td colspan="3"><div class="empty-row">No rejected decisions</div></td></tr>`;
  const orderBookRows = snapshot.orderBookSnapshots.slice(-20).reverse().map(orderBookRow).join("") || `<tr><td colspan="6"><div class="empty-row">No order book liquidity data</div></td></tr>`;
  const scannerStatus = snapshot.runtime.paused ? "Paused" : "Running";
  const lastError = snapshot.runtime.lastScanError || "No recent scanner error";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Crypto Alert Bot Dashboard</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #080b12;
      --surface: #111827;
      --surface-soft: #0f1623;
      --surface-strong: #182231;
      --border: rgba(148, 163, 184, 0.2);
      --text: #eef4f8;
      --muted: #97a6ba;
      --faint: #66758a;
      --cyan: #2dd4bf;
      --blue: #60a5fa;
      --amber: #fbbf24;
      --red: #fb7185;
      --green: #4ade80;
      --shadow: 0 18px 42px rgba(0, 0, 0, 0.32);
    }
    * { box-sizing: border-box; }
    html { height: 100%; }
    body {
      margin: 0;
      min-width: 320px;
      height: 100%;
      overflow: hidden;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at top left, rgba(45, 212, 191, 0.12), transparent 28%),
        radial-gradient(circle at top right, rgba(251, 191, 36, 0.08), transparent 24%),
        var(--bg);
    }
    header {
      border-bottom: 1px solid var(--border);
      background: rgba(8, 11, 18, 0.88);
      backdrop-filter: blur(14px);
      height: 72px;
    }
    .topbar {
      width: 100%;
      height: 100%;
      padding: 12px 18px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    h1 { margin: 0; font-size: clamp(20px, 2.2vw, 26px); line-height: 1.05; letter-spacing: 0; }
    .subtitle { margin-top: 6px; color: var(--muted); font-size: 13px; }
    .toolbar {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      flex-wrap: wrap;
    }
    .link-button {
      display: inline-flex;
      align-items: center;
      min-height: 40px;
      padding: 0 12px;
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text);
      background: rgba(17, 24, 39, 0.82);
      text-decoration: none;
      font-size: 13px;
      font-weight: 700;
    }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 40px;
      padding: 0 12px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: rgba(17, 24, 39, 0.82);
      color: var(--text);
      white-space: nowrap;
      font-weight: 700;
    }
    .dot { width: 8px; height: 8px; border-radius: 999px; background: var(--green); box-shadow: 0 0 18px var(--green); }
    .dot.paused { background: var(--amber); box-shadow: 0 0 18px var(--amber); }
    main.dashboard-shell {
      height: calc(100dvh - 72px);
      padding: 12px;
      display: grid;
      grid-template-rows: auto auto minmax(0, 1fr);
      gap: 12px;
      overflow: hidden;
    }
    h2 { margin: 0; font-size: 15px; line-height: 1.2; letter-spacing: 0; color: var(--text); }
    .overview {
      display: grid;
      grid-template-columns: 1.35fr 0.65fr;
      gap: 12px;
      min-height: 78px;
    }
    .panel {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: rgba(17, 24, 39, 0.88);
      box-shadow: var(--shadow);
      padding: 12px;
      min-width: 0;
    }
    .panel-title {
      margin: 0 0 8px;
      font-size: 13px;
      color: var(--muted);
      text-transform: uppercase;
      font-weight: 800;
    }
    .status-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }
    .status-item {
      min-height: 50px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface-soft);
      padding: 9px;
    }
    .status-item span,
    .metric span {
      display: block;
      color: var(--muted);
      font-size: 11px;
      text-transform: uppercase;
      font-weight: 800;
    }
    .status-item strong {
      display: block;
      margin-top: 5px;
      font-size: 15px;
      line-height: 1.15;
      overflow-wrap: anywhere;
    }
    .notice {
      border-left: 4px solid var(--blue);
      background: var(--surface-soft);
      padding: 9px 10px;
      border-radius: 8px;
      color: var(--muted);
      line-height: 1.35;
      min-height: 50px;
      max-height: 52px;
      overflow: auto;
      overflow-wrap: anywhere;
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(12, minmax(132px, 1fr));
      gap: 8px;
      overflow-x: auto;
      overflow-y: hidden;
      padding-bottom: 2px;
      scrollbar-width: thin;
    }
    .metric {
      min-height: 72px;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 11px;
      background: rgba(17, 24, 39, 0.88);
      box-shadow: var(--shadow);
      min-width: 132px;
    }
    .metric strong {
      display: block;
      margin-top: 7px;
      font-size: clamp(18px, 2.2vw, 24px);
      line-height: 1.05;
      overflow-wrap: anywhere;
    }
    .main-grid {
      min-height: 0;
      display: grid;
      grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.95fr) minmax(0, 0.9fr);
      grid-template-rows: minmax(0, 1fr) minmax(0, 0.95fr);
      gap: 12px;
      grid-template-areas:
        "open price orderbook"
        "closed equity rejected";
    }
    .dashboard-card {
      min-width: 0;
      min-height: 0;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: rgba(17, 24, 39, 0.88);
      box-shadow: var(--shadow);
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
      overflow: hidden;
    }
    .card-open { grid-area: open; }
    .card-price { grid-area: price; }
    .card-orderbook { grid-area: orderbook; }
    .card-closed { grid-area: closed; }
    .card-equity { grid-area: equity; }
    .card-rejected { grid-area: rejected; }
    .card-head {
      min-height: 44px;
      padding: 12px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      border-bottom: 1px solid var(--border);
      background: rgba(24, 34, 49, 0.62);
    }
    .card-note {
      color: var(--muted);
      font-size: 12px;
      white-space: nowrap;
    }
    .table-wrap, .chart-wrap {
      min-height: 0;
      overflow: auto;
    }
    table { width: 100%; min-width: 820px; border-collapse: collapse; }
    th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid rgba(148, 163, 184, 0.14); font-size: 12px; vertical-align: middle; }
    th { color: var(--muted); background: var(--surface-soft); font-size: 11px; text-transform: uppercase; position: sticky; top: 0; z-index: 1; }
    td { color: var(--text); }
    tr:last-child td { border-bottom: 0; }
    tr:hover td { background: rgba(148, 163, 184, 0.06); }
    .badge, .side, .liquidity {
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
    .success, .buy { color: var(--green); background: rgba(74, 222, 128, 0.12); }
    .danger, .sell { color: var(--red); background: rgba(251, 113, 133, 0.12); }
    .warn { color: var(--amber); background: rgba(251, 191, 36, 0.12); }
    .neutral { color: var(--blue); background: rgba(96, 165, 250, 0.12); }
    .cell-muted {
      display: block;
      margin-top: 3px;
      color: var(--faint);
      font-size: 12px;
    }
    .target-progress {
      display: inline-grid;
      grid-template-columns: repeat(3, 42px);
      gap: 4px;
    }
    .target-progress span {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 24px;
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--faint);
      background: rgba(15, 22, 35, 0.9);
      font-size: 11px;
      font-weight: 800;
    }
    .target-progress .hit {
      color: var(--green);
      border-color: rgba(22, 128, 60, 0.35);
      background: rgba(74, 222, 128, 0.12);
    }
    .liquidity {
      gap: 8px;
      border-radius: 8px;
    }
    .liquidity small {
      color: var(--muted);
      font-size: 11px;
      font-weight: 800;
    }
    .chart-wrap { padding: 12px; }
    .chart { width: 100%; height: 100%; min-height: 180px; display: block; }
    .chart-grid { fill: none; stroke: rgba(148, 163, 184, 0.18); stroke-width: 1; }
    .marker-buy { fill: var(--green); stroke: #080b12; stroke-width: 3; }
    .marker-sell { fill: var(--red); stroke: #080b12; stroke-width: 3; }
    .empty-chart {
      min-height: 160px;
      display: grid;
      place-items: center;
      color: var(--muted);
      border: 1px dashed rgba(148, 163, 184, 0.28);
      border-radius: 8px;
      background: rgba(15, 22, 35, 0.9);
    }
    .empty-row {
      min-height: 44px;
      display: grid;
      align-items: center;
      color: var(--muted);
    }
    @media (max-width: 720px) {
      body { height: auto; min-height: 100%; overflow: auto; }
      header { height: auto; }
      .topbar { align-items: flex-start; flex-direction: column; padding: 14px; }
      main.dashboard-shell { height: auto; min-height: calc(100dvh - 112px); overflow: visible; padding: 12px; }
      .toolbar { width: 100%; justify-content: flex-start; }
      .overview { grid-template-columns: 1fr; }
      .status-grid { grid-template-columns: 1fr; }
      .metrics { grid-template-columns: 1fr 1fr; overflow: visible; }
      .metric { min-height: 78px; padding: 12px; }
      .main-grid { grid-template-columns: 1fr; grid-template-rows: none; grid-template-areas: "open" "price" "orderbook" "equity" "closed" "rejected"; }
      .dashboard-card { min-height: 320px; }
      .card-price, .card-equity { min-height: 280px; }
    }
    @media (max-width: 460px) {
      .metrics { grid-template-columns: 1fr; }
      .status-pill { width: 100%; justify-content: center; }
      .link-button { width: 100%; justify-content: center; }
    }
  </style>
</head>
<body>
  <header>
    <div class="topbar">
      <div>
        <h1>Crypto Alert Bot Dashboard</h1>
        <div class="subtitle">Bot status: ${escapeHtml(status)} | Last successful scan ${escapeHtml(formatAge(snapshot.runtime.lastScanSuccessAt))}</div>
      </div>
      <div class="toolbar">
        <a class="link-button" href="/dashboard.json">JSON</a>
        <a class="link-button" href="/metrics">Metrics</a>
        <div class="status-pill"><span class="dot ${snapshot.runtime.paused ? "paused" : ""}"></span>${escapeHtml(scannerStatus)}</div>
      </div>
    </div>
  </header>
  <main class="dashboard-shell">
    <section class="overview">
      <div class="panel">
        <p class="panel-title">Scanner Health</p>
        <div class="status-grid">
          <div class="status-item"><span>Last Scan</span><strong>${escapeHtml(formatAge(snapshot.runtime.lastScanAt))}</strong></div>
          <div class="status-item"><span>Last Success</span><strong>${escapeHtml(formatDate(snapshot.runtime.lastScanSuccessAt))}</strong></div>
          <div class="status-item"><span>Tracked Symbols</span><strong>${escapeHtml(stats.activeSymbols)}</strong></div>
        </div>
      </div>
      <div class="panel">
        <p class="panel-title">Latest Error</p>
        <div class="notice">${escapeHtml(lastError)}</div>
      </div>
    </section>
    <section class="metrics">
      <div class="metric"><span>Recent Paper Winrate</span><strong>${escapeHtml(formatPercent(stats.winRate, 1))}</strong></div>
      <div class="metric"><span>Recent Avg R</span><strong>${escapeHtml(formatR(stats.avgR))}</strong></div>
      <div class="metric"><span>Open Trades</span><strong>${snapshot.totals.open}</strong></div>
      <div class="metric"><span>Closed Trades</span><strong>${snapshot.totals.closed}</strong></div>
      <div class="metric"><span>Recent TP2 Wins</span><strong>${escapeHtml(stats.wins)}</strong></div>
      <div class="metric"><span>Recent SL Losses</span><strong>${escapeHtml(stats.losses)}</strong></div>
      <div class="metric"><span>Recent Liquidations</span><strong>${escapeHtml(stats.liquidations)}</strong></div>
      <div class="metric"><span>Paper Balance</span><strong>${escapeHtml(formatNumber(stats.balance, 2))}</strong></div>
      <div class="metric"><span>Balance Change</span><strong>${escapeHtml(formatPercent(stats.balanceChange, 1))}</strong></div>
      <div class="metric"><span>Realized PnL</span><strong>${escapeHtml(formatNumber(stats.realizedPnl, 2))}</strong></div>
      <div class="metric"><span>Available Balance</span><strong>${escapeHtml(formatNumber(stats.available, 2))}</strong></div>
      <div class="metric"><span>Margin Usage</span><strong>${escapeHtml(formatPercent(stats.marginUsage, 1))}</strong></div>
      <div class="metric"><span>Signals Accepted</span><strong>${escapeHtml(stats.accepted)}</strong></div>
      <div class="metric"><span>Signals Rejected</span><strong>${escapeHtml(stats.rejected)}</strong></div>
    </section>
    <section class="main-grid">
      <section class="dashboard-card card-open">
        <div class="card-head"><h2>Open Trades</h2><span class="card-note">${escapeHtml(snapshot.openTrades.length)} active</span></div>
        <div class="table-wrap"><table><thead><tr><th>Status</th><th>Symbol</th><th>Side</th><th>Entry</th><th>SL</th><th>TP2</th><th>Exit</th><th>Targets</th><th>R</th><th>Opened</th></tr></thead><tbody>${openRows}</tbody></table></div>
      </section>
      <section class="dashboard-card card-price">
        <div class="card-head"><h2>Recent Candle Close</h2><span class="card-note">${escapeHtml(snapshot.marketSnapshots.length)} points</span></div>
        <div class="chart-wrap">${buildPriceSvg(snapshot.marketSnapshots, snapshot.signalDecisions)}</div>
      </section>
      <section class="dashboard-card card-orderbook">
        <div class="card-head"><h2>Liquidity Walls</h2><span class="card-note">order book</span></div>
        <div class="table-wrap"><table><thead><tr><th>Symbol</th><th>Mid</th><th>Spread</th><th>Nearest Bid Wall</th><th>Nearest Ask Wall</th><th>Time</th></tr></thead><tbody>${orderBookRows}</tbody></table></div>
      </section>
      <section class="dashboard-card card-closed">
        <div class="card-head"><h2>Recent Closed Trades</h2><span class="card-note">last 50</span></div>
        <div class="table-wrap"><table><thead><tr><th>Status</th><th>Symbol</th><th>Side</th><th>Entry</th><th>SL</th><th>TP2</th><th>Exit</th><th>Targets</th><th>R</th><th>Opened</th></tr></thead><tbody>${closedRows}</tbody></table></div>
      </section>
      <section class="dashboard-card card-equity">
        <div class="card-head"><h2>Paper Equity Curve</h2><span class="card-note">${escapeHtml((snapshot.paperAccount?.equityCurve || []).length)} points</span></div>
        <div class="chart-wrap">${buildEquitySvg(snapshot.paperAccount?.equityCurve || [])}</div>
      </section>
      <section class="dashboard-card card-rejected">
        <div class="card-head"><h2>Rejected Decisions</h2><span class="card-note">last 20</span></div>
        <div class="table-wrap"><table><thead><tr><th>Symbol</th><th>Reason</th><th>Time</th></tr></thead><tbody>${rejectedRows}</tbody></table></div>
      </section>
    </section>
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
