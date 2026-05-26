import axios from "axios";
import { getPaperAccountState, getPerformanceState, getRuntimeState } from "./state.js";
import { escapeHtml, formatDateTime, formatNumber } from "./utils.js";

function parseCommand(text) {
  const firstToken = String(text || "").trim().split(/\s+/)[0] || "";
  const command = firstToken.split("@")[0].toLowerCase();
  return command.startsWith("/") ? command : null;
}

function parseCommandArgs(text) {
  return String(text || "").trim().split(/\s+/).slice(1);
}

function isAuthorized(message, telegramConfig) {
  return getRole(message, telegramConfig) !== "none";
}

function getRole(message, telegramConfig) {
  const adminIds = telegramConfig.adminIds.map(String);
  const operatorIds = telegramConfig.operatorIds.map(String);
  const viewerIds = telegramConfig.viewerIds.map(String);
  const fromId = message.from?.id !== undefined ? String(message.from.id) : "";
  const chatId = message.chat?.id !== undefined ? String(message.chat.id) : "";

  if (adminIds.includes(fromId) || adminIds.includes(chatId)) return "owner";
  if (operatorIds.includes(fromId) || operatorIds.includes(chatId)) return "operator";
  if (viewerIds.includes(fromId) || viewerIds.includes(chatId)) return "viewer";
  if (adminIds.length === 0 && operatorIds.length === 0 && viewerIds.length === 0 && chatId === String(telegramConfig.chatId)) return "owner";
  return "none";
}

function canMutate(role) {
  return role === "owner" || role === "operator";
}

async function getUpdates(botToken, offset, timeoutSeconds) {
  const url = `https://api.telegram.org/bot${botToken}/getUpdates`;
  const response = await axios.get(url, {
    params: {
      offset,
      timeout: timeoutSeconds,
      allowed_updates: JSON.stringify(["message", "callback_query"])
    },
    timeout: (timeoutSeconds + 5) * 1000
  });

  if (!response.data?.ok) {
    throw new Error(response.data?.description || "Telegram getUpdates gagal.");
  }

  return response.data.result || [];
}

async function answerCallbackQuery(botToken, callbackQueryId) {
  if (!callbackQueryId) return;

  const url = `https://api.telegram.org/bot${botToken}/answerCallbackQuery`;
  await axios.post(url, { callback_query_id: callbackQueryId }, { timeout: 15000 });
}

function buildControlKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "Status", callback_data: "cmd:/status" },
        { text: "Performance", callback_data: "cmd:/performance" }
      ],
      [
        { text: "Open", callback_data: "cmd:/open" },
        { text: "Paper", callback_data: "cmd:/paper" }
      ],
      [
        { text: "Risk", callback_data: "cmd:/risk" },
        { text: "Rejected", callback_data: "cmd:/rejected" }
      ],
      [
        { text: "Pause", callback_data: "cmd:/pause" },
        { text: "Resume", callback_data: "cmd:/resume" },
        { text: "Scan Once", callback_data: "cmd:/scanonce" }
      ]
    ]
  };
}

function buildHelpMessage() {
  return `
<b>Crypto Alert Bot Commands</b>

/status - status bot dan scan terakhir
/performance - ringkasan performa all-time
/paper - ringkasan paper trading
/risk - ringkasan risk paper trading
/equity - saldo dan PnL paper trading
/drawdown - drawdown paper trading
/rejected - alasan sinyal/trade ditolak
/lastsignal SYMBOL - decision terakhir untuk symbol
/why SYMBOL - alasan terakhir symbol diterima/ditolak
/backup - ringkasan backup state
/open - daftar trade terbuka
/symbols - daftar symbol yang dipantau
/pause - pause scanner
/resume - lanjutkan scanner
/scanonce - scan manual sekali
/setpaper on|off|default - override paper trading runtime
/setpaused SYMBOL on|off - pause/resume symbol
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
  const performance = getPerformanceState(state);
  const paperTrades = performance.paperTrades;
  const account = getPaperAccountState(state);
  const closed = paperTrades.filter((trade) => trade.outcome);
  const open = paperTrades.length - closed.length;
  const wins = closed.filter((trade) => trade.outcome === "TP3" || trade.tp2Hit).length;
  const losses = closed.filter((trade) => trade.outcome === "SL").length;
  const liquidations = closed.filter((trade) => trade.outcome === "LIQUIDATED").length;
  const avgR = closed.reduce((sum, trade) => sum + (Number(trade.realizedR) || 0), 0) / (closed.length || 1);

  return `
<b>Paper Trading</b>

<b>Initial Balance:</b> ${escapeHtml(formatNumber(account.initialBalance, 2))} USDT
<b>Balance:</b> ${escapeHtml(formatNumber(account.balance, 2))} USDT
<b>Used Margin:</b> ${escapeHtml(formatNumber(account.usedMargin, 2))} USDT
<b>Available:</b> ${escapeHtml(formatNumber((Number(account.balance) || 0) - (Number(account.usedMargin) || 0), 2))} USDT

<b>Total Trades:</b> ${escapeHtml(String(paperTrades.length))}
<b>Open:</b> ${escapeHtml(String(open))}
<b>Closed:</b> ${escapeHtml(String(closed.length))}
<b>Wins:</b> ${escapeHtml(String(wins))}
<b>Losses:</b> ${escapeHtml(String(losses))}
<b>Liquidations:</b> ${escapeHtml(String(liquidations))}
<b>Winrate:</b> ${escapeHtml(formatNumber(closed.length > 0 ? wins / closed.length * 100 : 0, 2))}%
<b>Avg R:</b> ${escapeHtml(formatNumber(avgR, 2))}R
<b>Realized PnL:</b> ${escapeHtml(formatNumber(account.realizedPnl, 2))} USDT
<b>Total Fees:</b> ${escapeHtml(formatNumber(account.totalFees, 2))} USDT
<b>Rejected Trades:</b> ${escapeHtml(String(account.rejectedTrades || 0))}
`.trim();
}

function buildRiskMessage(state) {
  const account = getPaperAccountState(state);
  const paperTrades = getPerformanceState(state).paperTrades;
  const openTrades = paperTrades.filter((trade) => !trade.outcome);
  const openNotional = openTrades.reduce((sum, trade) => sum + (Number(trade.remainingNotional) || 0), 0);
  const liquidationRisk = openTrades.map((trade) => (
    `${escapeHtml(trade.symbol)} ${escapeHtml(trade.direction)} liq=${escapeHtml(formatNumber(trade.liquidationPrice, 12))} margin=${escapeHtml(formatNumber(trade.remainingMargin, 2))}`
  ));

  return `
<b>Paper Risk</b>

<b>Balance:</b> ${escapeHtml(formatNumber(account.balance, 2))} USDT
<b>Used Margin:</b> ${escapeHtml(formatNumber(account.usedMargin, 2))} USDT
<b>Open Notional:</b> ${escapeHtml(formatNumber(openNotional, 2))} USDT
<b>Daily PnL:</b> ${escapeHtml(formatNumber(account.dailyPnl, 2))} USDT
<b>Peak Balance:</b> ${escapeHtml(formatNumber(account.peakBalance, 2))} USDT
<b>Kill Switch:</b> ${account.killSwitchActive ? escapeHtml(account.killSwitchReason || "ACTIVE") : "-"}

${liquidationRisk.length ? liquidationRisk.slice(0, 10).join("\n") : "Tidak ada posisi paper terbuka."}
`.trim();
}

function buildDrawdownMessage(state) {
  const account = getPaperAccountState(state);
  const balance = Number(account.balance) || 0;
  const peak = Number(account.peakBalance) || balance;
  const drawdown = peak > 0 ? (peak - balance) / peak * 100 : 0;

  return `
<b>Paper Drawdown</b>

<b>Balance:</b> ${escapeHtml(formatNumber(balance, 2))} USDT
<b>Peak:</b> ${escapeHtml(formatNumber(peak, 2))} USDT
<b>Drawdown:</b> ${escapeHtml(formatNumber(drawdown, 2))}%
`.trim();
}

function buildRejectedMessage(state) {
  const performance = getPerformanceState(state);
  const decisions = state.research?.signalDecisions || [];
  const rejected = decisions.filter((decision) => !decision.accepted).slice(-10).reverse();
  const rows = rejected.map((decision) => (
    `${escapeHtml(decision.symbol || "-")} ${escapeHtml(decision.reason || decision.paperRejectReason || "-")} ${escapeHtml(formatDateTime(decision.at))}`
  ));

  return `
<b>Rejected Signals / Trades</b>

<b>Paper Rejected:</b> ${escapeHtml(String(performance.paperAccount?.rejectedTrades || 0))}
<b>Last Paper Reason:</b> ${escapeHtml(performance.paperAccount?.lastRejectReason || "-")}

${rows.length ? rows.join("\n") : "Belum ada rejected decision tersimpan."}
`.trim();
}

function buildLastSignalMessage(state, symbol = "") {
  const decisions = state.research?.signalDecisions || [];
  const target = symbol.trim().toUpperCase();
  const decision = [...decisions].reverse().find((item) => !target || String(item.symbol || "").toUpperCase() === target);
  if (!decision) return "<b>Last Signal</b>\n\nBelum ada signal decision tersimpan.";

  return `
<b>Last Signal Decision</b>

<b>Symbol:</b> ${escapeHtml(decision.symbol || "-")}
<b>Accepted:</b> ${decision.accepted ? "YES" : "NO"}
<b>Reason:</b> ${escapeHtml(decision.reason || decision.paperRejectReason || "-")}
<b>Direction:</b> ${escapeHtml(decision.direction || "-")}
<b>Entry Mode:</b> ${escapeHtml(decision.entryMode || decision.debug?.entryMode || "-")}
<b>Score:</b> ${escapeHtml(String(decision.score ?? "-"))}
<b>RR:</b> ${escapeHtml(formatNumber(decision.rr, 2))}
<b>At:</b> ${escapeHtml(formatDateTime(decision.at))}
`.trim();
}

function buildBackupMessage(state) {
  const performance = getPerformanceState(state);
  const backup = {
    schemaVersion: state.schemaVersion,
    generatedAt: new Date().toISOString(),
    openTrades: performance.openTrades.length,
    closedTrades: performance.closedTrades.length,
    paperTrades: performance.paperTrades.length,
    paperAccount: performance.paperAccount,
    runtime: getRuntimeState(state)
  };
  return `<b>State Backup Summary</b>\n\n<code>${escapeHtml(JSON.stringify(backup))}</code>`;
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
<b>Paper Notional:</b> ${escapeHtml(formatNumber(config.paper.positionNotional, 2))} USDT
<b>Paper Leverage:</b> ${escapeHtml(formatNumber(config.paper.leverage, 2))}x
`.trim();
}

async function handleCommand({ command, message, state, stateStore, config, appStatus, notify, role }) {
  const keyboard = buildControlKeyboard();
  const args = parseCommandArgs(message.text);

  switch (command) {
    case "/start":
    case "/help":
      await notify(buildHelpMessage(), message.chat.id, keyboard);
      break;
    case "/status":
      await notify(buildStatusMessage({ state, config, appStatus }), message.chat.id, keyboard);
      break;
    case "/performance":
      await notify(buildAllTimePerformanceMessage(state), message.chat.id, keyboard);
      break;
    case "/paper":
      await notify(buildPaperMessage(state), message.chat.id, keyboard);
      break;
    case "/risk":
      await notify(buildRiskMessage(state), message.chat.id, keyboard);
      break;
    case "/equity":
      await notify(buildPaperMessage(state), message.chat.id, keyboard);
      break;
    case "/drawdown":
      await notify(buildDrawdownMessage(state), message.chat.id, keyboard);
      break;
    case "/rejected":
      await notify(buildRejectedMessage(state), message.chat.id, keyboard);
      break;
    case "/lastsignal":
    case "/why":
      await notify(buildLastSignalMessage(state, args[0] || ""), message.chat.id, keyboard);
      break;
    case "/backup":
      await notify(buildBackupMessage(state), message.chat.id, keyboard);
      break;
    case "/open":
      await notify(buildOpenTradesMessage(state), message.chat.id, keyboard);
      break;
    case "/symbols":
      await notify(`<b>Symbols</b>\n\n${escapeHtml(config.exchange.symbols.join("\n"))}`, message.chat.id);
      break;
    case "/settings":
      await notify(buildSettingsMessage(config, stateStore.type), message.chat.id, keyboard);
      break;
    case "/pause":
      if (!canMutate(role)) {
        await notify("Akses ditolak untuk command kontrol.", message.chat.id);
        break;
      }
      getRuntimeState(state).paused = true;
      await stateStore.save(state);
      await notify("Scanner dipause.", message.chat.id);
      break;
    case "/resume":
      if (!canMutate(role)) {
        await notify("Akses ditolak untuk command kontrol.", message.chat.id);
        break;
      }
      getRuntimeState(state).paused = false;
      await stateStore.save(state);
      await notify("Scanner dilanjutkan.", message.chat.id);
      break;
    case "/scanonce":
      if (!canMutate(role)) {
        await notify("Akses ditolak untuk command kontrol.", message.chat.id);
        break;
      }
      appStatus.scanRequested = true;
      await notify("Scan manual dijadwalkan.", message.chat.id);
      break;
    case "/setpaper": {
      if (!canMutate(role)) {
        await notify("Akses ditolak untuk command kontrol.", message.chat.id);
        break;
      }
      const value = args[0] || "default";
      const runtime = getRuntimeState(state);
      runtime.paperEnabledOverride = value === "on" ? true : value === "off" ? false : null;
      await stateStore.save(state);
      await notify(`Paper runtime override: ${runtime.paperEnabledOverride === null ? "default" : runtime.paperEnabledOverride ? "on" : "off"}.`, message.chat.id);
      break;
    }
    case "/setpaused": {
      if (!canMutate(role)) {
        await notify("Akses ditolak untuk command kontrol.", message.chat.id);
        break;
      }
      const [symbol, value] = args;
      if (!symbol || !["on", "off"].includes(value)) {
        await notify("Format: /setpaused SYMBOL on|off", message.chat.id);
        break;
      }
      const runtime = getRuntimeState(state);
      runtime.pausedSymbols[symbol] = value === "on";
      await stateStore.save(state);
      await notify(`${symbol} ${value === "on" ? "dipause" : "diresume"}.`, message.chat.id);
      break;
    }
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
        const callbackQuery = update.callback_query;
        const message = callbackQuery
          ? { ...callbackQuery.message, from: callbackQuery.from, text: callbackQuery.data?.replace(/^cmd:/, "") }
          : update.message;
        const command = parseCommand(message?.text);
        if (!message || !command) continue;

        if (!isAuthorized(message, config.telegram)) {
          await notify("Akses ditolak.", message.chat.id);
          if (callbackQuery) await answerCallbackQuery(config.telegram.botToken, callbackQuery.id);
          continue;
        }

        const role = getRole(message, config.telegram);
        await handleCommand({ command, message, state, stateStore, config, appStatus, notify, role });
        if (callbackQuery) await answerCallbackQuery(config.telegram.botToken, callbackQuery.id);
      }

      if (updates.length > 0) await stateStore.save(state);
    } catch (error) {
      console.error("[ERROR] command loop:", error.message);
    }
  }
}
