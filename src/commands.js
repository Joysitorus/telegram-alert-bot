import axios from "axios";
import { getPerformanceState, getRuntimeState } from "./state.js";
import { escapeHtml, formatDateTime, formatNumber } from "./utils.js";

function parseCommand(text) {
  const firstToken = String(text || "").trim().split(/\s+/)[0] || "";
  const command = firstToken.split("@")[0].toLowerCase();
  return command.startsWith("/") ? command : null;
}

function isAuthorized(message, telegramConfig) {
  const adminIds = telegramConfig.adminIds.map(String);
  const fromId = message.from?.id !== undefined ? String(message.from.id) : "";
  const chatId = message.chat?.id !== undefined ? String(message.chat.id) : "";

  if (adminIds.length > 0) return adminIds.includes(fromId) || adminIds.includes(chatId);
  return chatId === String(telegramConfig.chatId);
}

async function getUpdates(botToken, offset, timeoutSeconds) {
  const url = `https://api.telegram.org/bot${botToken}/getUpdates`;
  const response = await axios.get(url, {
    params: {
      offset,
      timeout: timeoutSeconds,
      allowed_updates: JSON.stringify(["message"])
    },
    timeout: (timeoutSeconds + 5) * 1000
  });

  if (!response.data?.ok) {
    throw new Error(response.data?.description || "Telegram getUpdates gagal.");
  }

  return response.data.result || [];
}

function buildHelpMessage() {
  return `
<b>Crypto Alert Bot Commands</b>

/status - status bot dan scan terakhir
/performance - ringkasan performa all-time
/paper - ringkasan paper trading
/open - daftar trade terbuka
/symbols - daftar symbol yang dipantau
/pause - pause scanner
/resume - lanjutkan scanner
/scanonce - scan manual sekali
/settings - setting utama bot
/help - bantuan command
`.trim();
}

function buildStatusMessage({ state, config, appStatus }) {
  const runtime = getRuntimeState(state);
  const performance = getPerformanceState(state);

  return `
<b>Bot Status</b>

<b>Scanner:</b> ${runtime.paused ? "PAUSED" : "RUNNING"}
<b>Exchange:</b> ${escapeHtml(config.exchange.id)} ${escapeHtml(config.exchange.marketType)}
<b>Timeframe:</b> ${escapeHtml(config.exchange.timeframe)}
<b>Symbols:</b> ${escapeHtml(config.exchange.symbols.join(", "))}
<b>Open Trades:</b> ${escapeHtml(String(performance.openTrades.length))}

<b>Last Scan:</b> ${escapeHtml(formatDateTime(runtime.lastScanAt))}
<b>Last Success:</b> ${escapeHtml(formatDateTime(runtime.lastScanSuccessAt))}
<b>Last Error:</b> ${escapeHtml(runtime.lastScanError || "-")}
<b>Manual Scan:</b> ${appStatus.scanRequested ? "QUEUED" : "-"}
`.trim();
}

function buildAllTimePerformanceMessage(state) {
  const performance = getPerformanceState(state);
  const closed = performance.closedTrades;
  const wins = closed.filter((trade) => trade.outcome === "TP2").length;
  const tp3Hits = closed.filter((trade) => trade.outcome === "TP3" || trade.tp3Hit).length;
  const losses = closed.filter((trade) => trade.outcome === "SL").length;
  const pnlSum = closed.reduce((sum, trade) => sum + (Number(trade.pnlPercent) || 0), 0);
  const rSum = closed.reduce((sum, trade) => sum + (Number(trade.realizedR) || 0), 0);
  const targetHits = closed.filter((trade) => trade.tp1Hit || trade.tp2Hit || trade.tp3Hit).length;

  return `
<b>All-Time Performance</b>

<b>Closed Trades:</b> ${escapeHtml(String(closed.length))}
<b>Wins TP2:</b> ${escapeHtml(String(wins))}
<b>TP3 Hits:</b> ${escapeHtml(String(tp3Hits))}
<b>Losses SL:</b> ${escapeHtml(String(losses))}
<b>Winrate:</b> ${escapeHtml(formatNumber(closed.length > 0 ? wins / closed.length * 100 : 0, 2))}%
<b>Avg PnL:</b> ${escapeHtml(formatNumber(closed.length > 0 ? pnlSum / closed.length : 0, 2))}%
<b>Avg R:</b> ${escapeHtml(formatNumber(closed.length > 0 ? rSum / closed.length : 0, 2))}R
<b>TP Hit Rate:</b> ${escapeHtml(formatNumber(closed.length > 0 ? targetHits / closed.length * 100 : 0, 2))}%
<b>Open Trades:</b> ${escapeHtml(String(performance.openTrades.length))}
`.trim();
}

function buildPaperMessage(state) {
  const paperTrades = getPerformanceState(state).paperTrades;
  const closed = paperTrades.filter((trade) => trade.outcome);
  const open = paperTrades.length - closed.length;
  const wins = closed.filter((trade) => trade.outcome === "TP3" || trade.tp2Hit).length;
  const losses = closed.filter((trade) => trade.outcome === "SL").length;
  const avgR = closed.reduce((sum, trade) => sum + (Number(trade.realizedR) || 0), 0) / (closed.length || 1);

  return `
<b>Paper Trading</b>

<b>Total Trades:</b> ${escapeHtml(String(paperTrades.length))}
<b>Open:</b> ${escapeHtml(String(open))}
<b>Closed:</b> ${escapeHtml(String(closed.length))}
<b>Wins:</b> ${escapeHtml(String(wins))}
<b>Losses:</b> ${escapeHtml(String(losses))}
<b>Winrate:</b> ${escapeHtml(formatNumber(closed.length > 0 ? wins / closed.length * 100 : 0, 2))}%
<b>Avg R:</b> ${escapeHtml(formatNumber(avgR, 2))}R
`.trim();
}

function buildOpenTradesMessage(state) {
  const openTrades = getPerformanceState(state).openTrades;
  if (openTrades.length === 0) return "<b>Open Trades</b>\n\nTidak ada trade terbuka.";

  const rows = openTrades.slice(0, 20).map((trade, index) => (
    `${index + 1}. ${escapeHtml(trade.direction)} ${escapeHtml(trade.symbol)} ${escapeHtml(trade.timeframe)} ` +
    `entry=${escapeHtml(formatNumber(trade.entry, 12))} opened=${escapeHtml(formatDateTime(trade.openedAt))}`
  ));

  const suffix = openTrades.length > rows.length ? `\n\nDitampilkan ${rows.length} dari ${openTrades.length} trade.` : "";
  return `<b>Open Trades</b>\n\n${rows.join("\n")}${suffix}`;
}

function buildSettingsMessage(config, storeType) {
  return `
<b>Bot Settings</b>

<b>Storage:</b> ${escapeHtml(storeType)}
<b>Exchange:</b> ${escapeHtml(config.exchange.id)}
<b>Market Type:</b> ${escapeHtml(config.exchange.marketType)}
<b>Timeframe:</b> ${escapeHtml(config.exchange.timeframe)}
<b>Interval:</b> ${escapeHtml(String(config.exchange.checkIntervalSeconds))}s
<b>Candle Limit:</b> ${escapeHtml(String(config.exchange.candleLimit))}
<b>Min Confirm:</b> ${escapeHtml(String(config.strategy.minConfirm))}/7
<b>Min RR:</b> ${escapeHtml(formatNumber(config.strategy.minRR, 2))}R
<b>Max SL:</b> ${escapeHtml(formatNumber(config.strategy.maxSafeSlPercent, 2))}%
`.trim();
}

async function handleCommand({ command, message, state, stateStore, config, appStatus, notify }) {
  switch (command) {
    case "/start":
    case "/help":
      await notify(buildHelpMessage(), message.chat.id);
      break;
    case "/status":
      await notify(buildStatusMessage({ state, config, appStatus }), message.chat.id);
      break;
    case "/performance":
      await notify(buildAllTimePerformanceMessage(state), message.chat.id);
      break;
    case "/paper":
      await notify(buildPaperMessage(state), message.chat.id);
      break;
    case "/open":
      await notify(buildOpenTradesMessage(state), message.chat.id);
      break;
    case "/symbols":
      await notify(`<b>Symbols</b>\n\n${escapeHtml(config.exchange.symbols.join("\n"))}`, message.chat.id);
      break;
    case "/settings":
      await notify(buildSettingsMessage(config, stateStore.type), message.chat.id);
      break;
    case "/pause":
      getRuntimeState(state).paused = true;
      await stateStore.save(state);
      await notify("Scanner dipause.", message.chat.id);
      break;
    case "/resume":
      getRuntimeState(state).paused = false;
      await stateStore.save(state);
      await notify("Scanner dilanjutkan.", message.chat.id);
      break;
    case "/scanonce":
      appStatus.scanRequested = true;
      await notify("Scan manual dijadwalkan.", message.chat.id);
      break;
    default:
      await notify("Command tidak dikenal. Gunakan /help.", message.chat.id);
      break;
  }
}

export async function runCommandLoop({ state, stateStore, config, appStatus, notify, isShuttingDown }) {
  if (!config.telegram.commandsEnabled) return;

  while (!isShuttingDown()) {
    try {
      const runtime = getRuntimeState(state);
      const offset = runtime.lastUpdateId === null ? undefined : runtime.lastUpdateId + 1;
      const updates = await getUpdates(config.telegram.botToken, offset, config.telegram.commandPollTimeoutSeconds);

      for (const update of updates) {
        runtime.lastUpdateId = update.update_id;
        const message = update.message;
        const command = parseCommand(message?.text);
        if (!message || !command) continue;

        if (!isAuthorized(message, config.telegram)) {
          await notify("Akses ditolak.", message.chat.id);
          continue;
        }

        await handleCommand({ command, message, state, stateStore, config, appStatus, notify });
      }

      if (updates.length > 0) await stateStore.save(state);
    } catch (error) {
      console.error("[ERROR] command loop:", error.message);
    }
  }
}
