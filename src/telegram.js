import axios from "axios";
import { escapeHtml, formatDateTime, formatNumber, formatPrice } from "./utils.js";

export async function sendTelegramMessage({ botToken, chatId, text }) {
  if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN belum diisi.");
  if (!chatId) throw new Error("TELEGRAM_CHAT_ID belum diisi.");

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  await axios.post(url, {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true
  }, {
    timeout: 15000
  });
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

<b>RR TP3:</b> ${escapeHtml(formatNumber(signal.rr, 2))}R
<b>Probability:</b> ${escapeHtml(String(signal.probability))}%
<b>Score:</b> ${escapeHtml(String(signal.score))}/7

<b>Liquidity Source:</b> ${escapeHtml(signal.liquiditySource)}
<b>Liquidity Score:</b> ${escapeHtml(formatNumber(signal.liquidityScore, 2))}
<b>Liquidity Touches:</b> ${escapeHtml(String(signal.liquidityTouches))}

<b>Order Block Score:</b> ${escapeHtml(formatNumber(signal.orderBlockScore, 2))}
<b>Order Block Zone:</b> <code>${escapeHtml(formatPrice(signal.orderBlockZoneLow, priceDecimals))}</code> - <code>${escapeHtml(formatPrice(signal.orderBlockZoneHigh, priceDecimals))}</code>
<b>Order Block Age:</b> ${escapeHtml(String(signal.orderBlockAge))} candles
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

export function buildErrorMessage(error, context = "") {
  return `
⚠️ <b>Crypto Alert Bot Error</b>

<b>Context:</b> ${escapeHtml(context || "-")}
<b>Error:</b> ${escapeHtml(error?.message || String(error))}
`.trim();
}
