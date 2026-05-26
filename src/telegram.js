import axios from "axios";
import { escapeHtml, formatDateTime, formatNumber, formatPrice } from "./utils.js";

export async function sendTelegramMessage({ botToken, chatId, text, replyMarkup = null }) {
  if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN belum diisi.");
  if (!chatId) throw new Error("TELEGRAM_CHAT_ID belum diisi.");

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  const payload = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true
  };

  if (replyMarkup) payload.reply_markup = replyMarkup;

  await axios.post(url, payload, {
    timeout: 15000
  });
}

export async function sendTelegramDocument({ botToken, chatId, filename, buffer, caption = "", contentType = "application/gzip" }) {
  if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN belum diisi.");
  if (!chatId) throw new Error("TELEGRAM_CHAT_ID belum diisi.");

  const url = `https://api.telegram.org/bot${botToken}/sendDocument`;
  const form = new FormData();
  form.append("chat_id", String(chatId));
  if (caption) {
    form.append("caption", caption);
    form.append("parse_mode", "HTML");
  }
  form.append("document", new Blob([buffer], { type: contentType }), filename);

  const response = await fetch(url, {
    method: "POST",
    body: form
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok || !body.ok) {
    throw new Error(body.description || `Telegram sendDocument gagal: ${response.status}`);
  }
}

export function buildSignalMessage(signal, priceDecimals = 12) {
  const directionEmoji = signal.direction === "BUY" ? "🟢" : "🔴";
  const pair = `${signal.exchange}:${signal.symbol}`;

  return `
${directionEmoji} <b>${escapeHtml(signal.direction)} SIGNAL</b>

<b>Pair:</b> ${escapeHtml(pair)}
<b>Timeframe:</b> ${escapeHtml(signal.timeframe)}
<b>Candle:</b> ${escapeHtml(formatDateTime(signal.candleTime))}
<b>Trend:</b> ${escapeHtml(signal.trend)}

<b>Entry:</b> <code>${escapeHtml(formatPrice(signal.entry, priceDecimals))}</code>
<b>SL Safe Zone ${escapeHtml(formatNumber(signal.slRiskPercent, 2))}%:</b> <code>${escapeHtml(formatPrice(signal.sl, priceDecimals))}</code>
<b>SL Source:</b> ${escapeHtml(signal.slSource)}

<b>TP1:</b> <code>${escapeHtml(formatPrice(signal.tp1, priceDecimals))}</code>
<b>TP2:</b> <code>${escapeHtml(formatPrice(signal.tp2, priceDecimals))}</code>
<b>TP3 Smart Liquidity:</b> <code>${escapeHtml(formatPrice(signal.tp3, priceDecimals))}</code>
<b>Exit Portions:</b> TP1 ${escapeHtml(formatNumber((signal.tp1ExitPortion ?? 0) * 100, 2))}% / TP2 ${escapeHtml(formatNumber((signal.tp2ExitPortion ?? 0) * 100, 2))}% / TP3 ${escapeHtml(formatNumber((signal.tp3ExitPortion ?? 0) * 100, 2))}%

<b>RR TP3:</b> ${escapeHtml(formatNumber(signal.rr, 2))}R
<b>Probability:</b> ${escapeHtml(String(signal.probability))}%
<b>Score:</b> ${escapeHtml(String(signal.score))}/7
<b>Market Regime:</b> ${escapeHtml(signal.marketRegime?.labels?.join(", ") || "-")}

<b>Liquidity Source:</b> ${escapeHtml(signal.liquiditySource)}
<b>Liquidity Score:</b> ${escapeHtml(formatNumber(signal.liquidityScore, 2))}
<b>Liquidity Touches:</b> ${escapeHtml(String(signal.liquidityTouches))}

<b>Order Block Score:</b> ${escapeHtml(formatNumber(signal.orderBlockScore, 2))}
<b>Order Block Zone:</b> <code>${escapeHtml(formatPrice(signal.orderBlockZoneLow, priceDecimals))}</code> - <code>${escapeHtml(formatPrice(signal.orderBlockZoneHigh, priceDecimals))}</code>
<b>Order Block Age:</b> ${escapeHtml(String(signal.orderBlockAge))} candles
`.trim();
}

export function buildTradeEventMessage(event, priceDecimals = 12) {
  const trade = event.trade;
  const title = event.paper ? "Paper Trade Update" : "Trade Update";
  return `
<b>${escapeHtml(title)}</b>

<b>Status:</b> ${escapeHtml(event.type)}
<b>Pair:</b> ${escapeHtml(`${trade.exchange}:${trade.symbol}`)}
<b>Direction:</b> ${escapeHtml(trade.direction)}
<b>Timeframe:</b> ${escapeHtml(trade.timeframe)}
<b>Exit:</b> <code>${escapeHtml(formatPrice(trade.exit, priceDecimals))}</code>
<b>Exit Portion:</b> ${escapeHtml(formatNumber((trade.exitPortion ?? 1) * 100, 2))}%
<b>Event R:</b> ${escapeHtml(formatNumber(trade.eventR ?? trade.realizedR, 2))}R
<b>Total R:</b> ${escapeHtml(formatNumber(trade.realizedR, 2))}R
<b>Event PnL:</b> ${escapeHtml(formatNumber(trade.eventPnlPercent ?? trade.pnlPercent, 2))}%
<b>Total PnL:</b> ${escapeHtml(formatNumber(trade.pnlPercent, 2))}%
<b>Event PnL USDT:</b> ${escapeHtml(formatNumber(trade.eventPnlUsdt, 4))}
<b>Total PnL USDT:</b> ${escapeHtml(formatNumber(trade.realizedPnlUsdt, 4))}
<b>Fees USDT:</b> ${escapeHtml(formatNumber(trade.totalFeesUsdt, 4))}
<b>Liquidation:</b> <code>${escapeHtml(formatPrice(trade.liquidationPrice, priceDecimals))}</code>
<b>Candle:</b> ${escapeHtml(formatDateTime(event.candleTime))}
`.trim();
}

export function buildStartupMessage({ exchangeId, symbols, timeframe, checkIntervalSeconds }) {
  return `
✅ <b>Crypto Alert Bot Started</b>

<b>Exchange:</b> ${escapeHtml(exchangeId)}
<b>Symbols:</b> ${escapeHtml(symbols.join(", "))}
<b>Timeframe:</b> ${escapeHtml(timeframe)}
<b>Interval:</b> ${escapeHtml(String(checkIntervalSeconds))} seconds
`.trim();
}

function buildPerformanceMessage(report, title) {
  return `
📊 <b>${escapeHtml(title)}</b>

<b>Period:</b> ${escapeHtml(formatDateTime(report.from))} - ${escapeHtml(formatDateTime(report.to))}
<b>Target Win:</b> Minimal TP2

<b>Closed Trades:</b> ${escapeHtml(String(report.closed))}
<b>Wins TP2:</b> ${escapeHtml(String(report.wins))}
<b>TP3 Hits:</b> ${escapeHtml(String(report.tp3Hits))}
<b>Losses SL:</b> ${escapeHtml(String(report.losses))}
<b>Winrate:</b> ${escapeHtml(formatNumber(report.winrate, 2))}%
<b>Avg PnL:</b> ${escapeHtml(formatNumber(report.avgPnlPercent, 2))}%
<b>Avg R:</b> ${escapeHtml(formatNumber(report.avgR, 2))}R
<b>TP Hit Rate:</b> ${escapeHtml(formatNumber(report.tpHitRate, 2))}%
<b>Open Trades:</b> ${escapeHtml(String(report.open))}

<b>All-Time Closed:</b> ${escapeHtml(String(report.allClosed))}
<b>All-Time Winrate:</b> ${escapeHtml(formatNumber(report.allWinrate, 2))}%
`.trim();
}

export function buildHeartbeatMessage({ runtime, openTrades }) {
  return `
<b>Bot Heartbeat</b>

<b>Status:</b> ${runtime.paused ? "PAUSED" : "RUNNING"}
<b>Last Success:</b> ${escapeHtml(formatDateTime(runtime.lastScanSuccessAt))}
<b>Open Trades:</b> ${escapeHtml(String(openTrades))}
<b>Last Error:</b> ${escapeHtml(runtime.lastScanError || "-")}
`.trim();
}

export function buildWeeklyPerformanceMessage(report) {
  return buildPerformanceMessage(report, "Weekly Winrate Report");
}

export function buildMonthlyPerformanceMessage(report) {
  return buildPerformanceMessage(report, "Monthly Winrate Report");
}

export function buildPaperPerformanceMessage(report) {
  return `
<b>Weekly Paper Trading Report</b>

<b>Period:</b> ${escapeHtml(formatDateTime(report.from))} - ${escapeHtml(formatDateTime(report.to))}
<b>Total Paper Trades:</b> ${escapeHtml(String(report.total))}
<b>Closed:</b> ${escapeHtml(String(report.closed))}
<b>Open:</b> ${escapeHtml(String(report.open))}
<b>Wins:</b> ${escapeHtml(String(report.wins))}
<b>Losses:</b> ${escapeHtml(String(report.losses))}
<b>Liquidations:</b> ${escapeHtml(String(report.liquidations))}
<b>Winrate:</b> ${escapeHtml(formatNumber(report.winrate, 2))}%
<b>Avg R:</b> ${escapeHtml(formatNumber(report.avgR, 2))}R
<b>Balance:</b> ${escapeHtml(formatNumber(report.balance, 2))} USDT
<b>Used Margin:</b> ${escapeHtml(formatNumber(report.usedMargin, 2))} USDT
<b>Available:</b> ${escapeHtml(formatNumber(report.availableBalance, 2))} USDT
<b>Realized PnL:</b> ${escapeHtml(formatNumber(report.realizedPnl, 2))} USDT
<b>Total Fees:</b> ${escapeHtml(formatNumber(report.totalFees, 2))} USDT
`.trim();
}

export function buildErrorMessage(error, context = "") {
  return `
⚠️ <b>Crypto Alert Bot Error</b>

<b>Context:</b> ${escapeHtml(context || "-")}
<b>Error:</b> ${escapeHtml(error?.message || String(error))}
`.trim();
}
