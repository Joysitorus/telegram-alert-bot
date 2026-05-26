import fs from "fs";
import path from "path";

export const CURRENT_STATE_SCHEMA_VERSION = 2;

function createDefaultPerformanceState() {
  return {
    openTrades: [],
    closedTrades: [],
    paperTrades: [],
    paperAccount: createDefaultPaperAccount(),
    lastWeeklyReportKey: null,
    lastMonthlyReportKey: null,
    lastPaperReportKey: null
  };
}

function createDefaultPaperAccount() {
  return {
    initialBalance: null,
    balance: null,
    usedMargin: 0,
    realizedPnl: 0,
    totalFees: 0,
    totalLiquidations: 0,
    rejectedTrades: 0,
    lastRejectReason: null,
    peakBalance: null,
    currentDay: null,
    dailyPnl: 0,
    killSwitchActive: false,
    killSwitchReason: null,
    equityCurve: []
  };
}

export function createDefaultState() {
  return {
    schemaVersion: CURRENT_STATE_SCHEMA_VERSION,
    pairs: {},
    research: {
      signalDecisions: [],
      marketSnapshots: []
    },
    performance: createDefaultPerformanceState(),
    runtime: {
      paused: false,
      paperEnabledOverride: null,
      pausedSymbols: {},
      lastUpdateId: null,
      lastScanAt: null,
      lastScanSuccessAt: null,
      lastScanErrorAt: null,
      lastScanError: null,
      lastHeartbeatAt: null
    }
  };
}

function normalizeTrade(trade) {
  const normalized = trade && typeof trade === "object" ? trade : {};
  if (!Object.hasOwn(normalized, "tp1")) normalized.tp1 = normalized.tp2;
  if (!Object.hasOwn(normalized, "tp3")) normalized.tp3 = normalized.tp2;
  if (!Object.hasOwn(normalized, "tp1ExitPortion")) normalized.tp1ExitPortion = 0.33;
  if (!Object.hasOwn(normalized, "tp2ExitPortion")) normalized.tp2ExitPortion = 0.33;
  if (!Object.hasOwn(normalized, "tp3ExitPortion")) normalized.tp3ExitPortion = Math.max(0, 1 - normalized.tp1ExitPortion - normalized.tp2ExitPortion);
  if (!Object.hasOwn(normalized, "tp1Hit")) normalized.tp1Hit = ["TP1_HIT", "TP2_HIT", "TP3_HIT"].includes(normalized.status);
  if (!Object.hasOwn(normalized, "tp2Hit")) normalized.tp2Hit = ["TP2_HIT", "TP3_HIT"].includes(normalized.status) || normalized.outcome === "TP2";
  if (!Object.hasOwn(normalized, "tp3Hit")) normalized.tp3Hit = normalized.status === "TP3_HIT" || normalized.outcome === "TP3";
  if (!Object.hasOwn(normalized, "realizedR")) normalized.realizedR = 0;
  if (!Object.hasOwn(normalized, "realizedPnlPercent")) normalized.realizedPnlPercent = normalized.pnlPercent || 0;
  if (!Object.hasOwn(normalized, "openCandleCount")) normalized.openCandleCount = 0;
  if (!Object.hasOwn(normalized, "positionNotional")) normalized.positionNotional = 0;
  if (!Object.hasOwn(normalized, "remainingNotional")) normalized.remainingNotional = normalized.positionNotional;
  if (!Object.hasOwn(normalized, "leverage")) normalized.leverage = 1;
  if (!Object.hasOwn(normalized, "initialMargin")) normalized.initialMargin = 0;
  if (!Object.hasOwn(normalized, "remainingMargin")) normalized.remainingMargin = normalized.initialMargin;
  if (!Object.hasOwn(normalized, "liquidationPrice")) normalized.liquidationPrice = null;
  if (!Object.hasOwn(normalized, "realizedPnlUsdt")) normalized.realizedPnlUsdt = 0;
  if (!Object.hasOwn(normalized, "totalFeesUsdt")) normalized.totalFeesUsdt = 0;
  if (!Object.hasOwn(normalized, "riskRejectReason")) normalized.riskRejectReason = null;
  return normalized;
}

function normalizePaperAccount(account) {
  const normalized = account && typeof account === "object" ? account : createDefaultPaperAccount();
  const defaults = createDefaultPaperAccount();
  for (const [key, value] of Object.entries(defaults)) {
    if (!Object.hasOwn(normalized, key)) normalized[key] = value;
  }
  return normalized;
}

export function normalizeState(state) {
  const normalized = state && typeof state === "object" ? state : createDefaultState();

  if (!Object.hasOwn(normalized, "schemaVersion")) normalized.schemaVersion = 1;
  normalized.schemaVersion = CURRENT_STATE_SCHEMA_VERSION;
  if (!normalized.pairs) normalized.pairs = {};
  if (!normalized.research) normalized.research = {};
  if (!Array.isArray(normalized.research.signalDecisions)) normalized.research.signalDecisions = [];
  if (!Array.isArray(normalized.research.marketSnapshots)) normalized.research.marketSnapshots = [];
  if (!normalized.performance) normalized.performance = createDefaultPerformanceState();
  if (!normalized.performance.openTrades) normalized.performance.openTrades = [];
  if (!normalized.performance.closedTrades) normalized.performance.closedTrades = [];
  if (!normalized.performance.paperTrades) normalized.performance.paperTrades = [];
  normalized.performance.paperAccount = normalizePaperAccount(normalized.performance.paperAccount);
  if (!Object.hasOwn(normalized.performance, "lastWeeklyReportKey")) normalized.performance.lastWeeklyReportKey = null;
  if (!Object.hasOwn(normalized.performance, "lastMonthlyReportKey")) normalized.performance.lastMonthlyReportKey = null;
  if (!Object.hasOwn(normalized.performance, "lastPaperReportKey")) normalized.performance.lastPaperReportKey = null;
  normalized.performance.openTrades = normalized.performance.openTrades.map(normalizeTrade);
  normalized.performance.closedTrades = normalized.performance.closedTrades.map(normalizeTrade);
  normalized.performance.paperTrades = normalized.performance.paperTrades.map(normalizeTrade);

  if (!normalized.runtime) normalized.runtime = {};
  if (!Object.hasOwn(normalized.runtime, "paused")) normalized.runtime.paused = false;
  if (!Object.hasOwn(normalized.runtime, "paperEnabledOverride")) normalized.runtime.paperEnabledOverride = null;
  if (!normalized.runtime.pausedSymbols) normalized.runtime.pausedSymbols = {};
  if (!Object.hasOwn(normalized.runtime, "lastUpdateId")) normalized.runtime.lastUpdateId = null;
  if (!Object.hasOwn(normalized.runtime, "lastScanAt")) normalized.runtime.lastScanAt = null;
  if (!Object.hasOwn(normalized.runtime, "lastScanSuccessAt")) normalized.runtime.lastScanSuccessAt = null;
  if (!Object.hasOwn(normalized.runtime, "lastScanErrorAt")) normalized.runtime.lastScanErrorAt = null;
  if (!Object.hasOwn(normalized.runtime, "lastScanError")) normalized.runtime.lastScanError = null;
  if (!Object.hasOwn(normalized.runtime, "lastHeartbeatAt")) normalized.runtime.lastHeartbeatAt = null;

  return normalized;
}

function buildTradeFromSignal(key, signal, prefix = "trade") {
  return {
    id: `${prefix}:${key}:${signal.candleTime}:${signal.direction}`,
    key,
    exchange: signal.exchange,
    strategyVersion: signal.strategyVersion,
    configHash: signal.configHash,
    symbol: signal.symbol,
    timeframe: signal.timeframe,
    direction: signal.direction,
    directionValue: signal.directionValue,
    entry: signal.entry,
    sl: signal.sl,
    tp1: signal.tp1,
    tp2: signal.tp2,
    tp3: signal.tp3,
    tp1ExitPortion: signal.tp1ExitPortion ?? 0.33,
    tp2ExitPortion: signal.tp2ExitPortion ?? 0.33,
    tp3ExitPortion: signal.tp3ExitPortion ?? 0.34,
    openedAt: signal.candleTime,
    lastCheckedCandleTime: signal.candleTime,
    score: signal.score,
    probability: signal.probability,
    orderBlockScore: signal.orderBlockScore,
    status: "OPEN",
    tp1Hit: false,
    tp2Hit: false,
    tp3Hit: false,
    realizedR: 0
  };
}

export function loadState(stateFile) {
  try {
    if (!fs.existsSync(stateFile)) {
      return createDefaultState();
    }

    const raw = fs.readFileSync(stateFile, "utf8");
    const parsed = JSON.parse(raw);
    if ((parsed.schemaVersion || 1) < CURRENT_STATE_SCHEMA_VERSION) {
      backupStateFile(stateFile);
    }

    return normalizeState(parsed);
  } catch (error) {
    console.warn(`Gagal membaca state file, membuat state baru. Error: ${error.message}`);
    return createDefaultState();
  }
}

export function getPerformanceState(state) {
  return normalizeState(state).performance;
}

export function getPaperAccountState(state, paperConfig = null) {
  const performance = getPerformanceState(state);
  return ensurePaperAccount(performance, paperConfig);
}

export function getRuntimeState(state) {
  return normalizeState(state).runtime;
}

export function saveState(stateFile, state) {
  const directory = path.dirname(stateFile);

  if (directory && directory !== "." && !fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }

  const tmpFile = `${stateFile}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(normalizeState(state), null, 2));
  fs.renameSync(tmpFile, stateFile);
}

export function backupStateFile(stateFile) {
  if (!fs.existsSync(stateFile)) return null;
  const backupFile = `${stateFile}.${new Date().toISOString().replace(/[:.]/g, "-")}.bak`;
  fs.copyFileSync(stateFile, backupFile);
  return backupFile;
}

export function getPairState(state, key) {
  if (!state.pairs) state.pairs = {};
  if (!state.pairs[key]) {
    state.pairs[key] = {
      lastDirection: 0,
      lastSignalCandleTime: null,
      lastSignalAt: null
    };
  }

  return state.pairs[key];
}

export function updatePairState(state, key, signal) {
  const pairState = getPairState(state, key);

  pairState.lastDirection = signal.directionValue;
  pairState.lastSignalCandleTime = signal.candleTime;
  pairState.lastSignalAt = Date.now();
  pairState.lastSignal = {
    direction: signal.direction,
    entry: signal.entry,
    sl: signal.sl,
    tp1: signal.tp1,
    tp2: signal.tp2,
    tp3: signal.tp3,
    rr: signal.rr,
    score: signal.score,
    probability: signal.probability
  };

  const performance = getPerformanceState(state);
  const tradeId = `trade:${key}:${signal.candleTime}:${signal.direction}`;
  const alreadyTracked = performance.openTrades.some((trade) => trade.id === tradeId) ||
    performance.closedTrades.some((trade) => trade.id === tradeId);

  if (!alreadyTracked) {
    performance.openTrades.push(buildTradeFromSignal(key, signal));
  }
}

export function addPaperTrade(state, key, signal, paperConfig = {}) {
  const performance = getPerformanceState(state);
  const trade = buildTradeFromSignal(key, signal, "paper");
  const account = ensurePaperAccount(performance, paperConfig);
  refreshPaperRiskState(account);

  const existing = performance.paperTrades.some((item) => item.id === trade.id);
  if (existing) return { added: false, reason: "duplicate" };

  if (account.killSwitchActive) {
    rejectPaperTrade(account, account.killSwitchReason || "kill_switch_active");
    return { added: false, reason: account.lastRejectReason };
  }

  const openTrades = performance.paperTrades.filter((item) => !item.outcome);
  if (paperConfig.maxOpenTrades > 0 && openTrades.length >= paperConfig.maxOpenTrades) {
    rejectPaperTrade(account, "max_open_trades");
    return { added: false, reason: "max_open_trades" };
  }

  trade.feePercent = Number(paperConfig.feePercent) || 0;
  trade.slippagePercent = Number(paperConfig.slippagePercent) || 0;
  trade.leverage = Number(paperConfig.leverage) || 1;
  trade.positionNotional = getPaperPositionNotional({ account, signal, paperConfig, leverage: trade.leverage });
  trade.remainingNotional = trade.positionNotional;
  trade.initialMargin = trade.leverage > 0 ? trade.positionNotional / trade.leverage : 0;
  trade.remainingMargin = trade.initialMargin;
  trade.maintenanceMarginPercent = Number(paperConfig.maintenanceMarginPercent) || 0;
  trade.liquidationPrice = getLiquidationPrice(trade);
  trade.entryFeeUsdt = trade.positionNotional * trade.feePercent / 100;
  trade.totalFeesUsdt = trade.entryFeeUsdt;
  trade.realizedPnlUsdt = -trade.entryFeeUsdt;

  const riskCheck = validatePaperTradeRisk({ trade, signal, account, openTrades, paperConfig });
  if (!riskCheck.valid) {
    rejectPaperTrade(account, riskCheck.reason);
    return { added: false, reason: riskCheck.reason };
  }

  const requiredBalance = trade.initialMargin + trade.entryFeeUsdt;
  if (trade.positionNotional > 0 && getAvailablePaperBalance(account) < requiredBalance) {
    rejectPaperTrade(account, "insufficient_balance");
    return { added: false, reason: "insufficient_balance" };
  }

  if (trade.positionNotional > 0) {
    account.balance -= trade.entryFeeUsdt;
    account.usedMargin += trade.initialMargin;
    account.realizedPnl -= trade.entryFeeUsdt;
    account.totalFees += trade.entryFeeUsdt;
    recordEquityPoint(account);
  }

  performance.paperTrades.push(trade);
  return { added: true, reason: null };
}

function rejectPaperTrade(account, reason) {
  account.rejectedTrades += 1;
  account.lastRejectReason = reason;
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function refreshPaperRiskState(account) {
  const todayKey = getTodayKey();
  if (account.currentDay !== todayKey) {
    account.currentDay = todayKey;
    account.dailyPnl = 0;
    if (account.killSwitchReason === "daily_loss_limit") {
      account.killSwitchActive = false;
      account.killSwitchReason = null;
    }
  }

  if (account.peakBalance === null || Number(account.balance) > Number(account.peakBalance)) {
    account.peakBalance = Number(account.balance) || 0;
  }
  if (!Array.isArray(account.equityCurve)) account.equityCurve = [];
}

function recordEquityPoint(account) {
  refreshPaperRiskState(account);
  account.equityCurve.push({
    at: Date.now(),
    balance: Number(account.balance) || 0,
    usedMargin: Number(account.usedMargin) || 0,
    realizedPnl: Number(account.realizedPnl) || 0
  });
  if (account.equityCurve.length > 500) account.equityCurve = account.equityCurve.slice(-500);
}

function getPaperPositionNotional({ account, signal, paperConfig, leverage }) {
  const balance = Number(account.balance) || 0;
  const slDistancePercent = signal.entry > 0 ? Math.abs(signal.entry - signal.sl) / signal.entry * 100 : 0;

  if (paperConfig.riskMode === "fixed_margin") {
    return (Number(paperConfig.fixedMargin) || 0) * leverage;
  }

  if (paperConfig.riskMode === "risk_percent_equity" || paperConfig.riskMode === "volatility_target") {
    const riskBudget = balance * ((Number(paperConfig.riskPercentEquity) || 0) / 100);
    if (slDistancePercent <= 0) return 0;
    return riskBudget / (slDistancePercent / 100);
  }

  return Number(paperConfig.positionNotional) || 0;
}

function getOpenPaperNotional(openTrades) {
  return openTrades.reduce((sum, trade) => sum + (Number(trade.remainingNotional) || 0), 0);
}

function liquidationComesBeforeStop(trade) {
  if (!trade.liquidationPrice || !trade.sl) return false;
  return trade.direction === "BUY"
    ? trade.liquidationPrice >= trade.sl
    : trade.liquidationPrice <= trade.sl;
}

function getLiquidationStopBufferPercent(trade) {
  if (!trade.liquidationPrice || !trade.sl || !trade.entry) return Infinity;
  return Math.abs(trade.sl - trade.liquidationPrice) / trade.entry * 100;
}

function validatePaperTradeRisk({ trade, signal, account, openTrades, paperConfig }) {
  if (trade.positionNotional <= 0) return { valid: false, reason: "invalid_position_notional" };
  if (liquidationComesBeforeStop(trade)) return { valid: false, reason: "liquidation_before_sl" };

  const liquidationBuffer = getLiquidationStopBufferPercent(trade);
  if (paperConfig.minLiquidationBufferPercent > 0 && liquidationBuffer < paperConfig.minLiquidationBufferPercent) {
    return { valid: false, reason: "liquidation_buffer_too_small" };
  }

  const slLossPercent = signal.entry > 0 ? Math.abs(signal.entry - signal.sl) / signal.entry * 100 : 0;
  const estimatedSlLoss = trade.positionNotional * slLossPercent / 100;
  const balance = Number(account.balance) || 0;

  if (paperConfig.maxLossUsdt > 0 && estimatedSlLoss > paperConfig.maxLossUsdt) {
    return { valid: false, reason: "max_loss_usdt_exceeded" };
  }

  if (paperConfig.maxLossPercentEquity > 0 && balance > 0 && estimatedSlLoss > balance * paperConfig.maxLossPercentEquity / 100) {
    return { valid: false, reason: "max_loss_percent_exceeded" };
  }

  if (paperConfig.dailyLossLimitUsdt > 0 && Math.abs(Math.min(0, Number(account.dailyPnl) || 0)) >= paperConfig.dailyLossLimitUsdt) {
    account.killSwitchActive = true;
    account.killSwitchReason = "daily_loss_limit";
    return { valid: false, reason: "daily_loss_limit" };
  }

  if (paperConfig.maxDrawdownPercent > 0 && account.peakBalance > 0) {
    const drawdownPercent = (account.peakBalance - balance) / account.peakBalance * 100;
    if (drawdownPercent >= paperConfig.maxDrawdownPercent) {
      account.killSwitchActive = true;
      account.killSwitchReason = "max_drawdown";
      return { valid: false, reason: "max_drawdown" };
    }
  }

  if (paperConfig.maxOpenNotional > 0 && getOpenPaperNotional(openTrades) + trade.positionNotional > paperConfig.maxOpenNotional) {
    return { valid: false, reason: "max_open_notional" };
  }

  if (paperConfig.maxUsedMargin > 0 && (Number(account.usedMargin) || 0) + trade.initialMargin > paperConfig.maxUsedMargin) {
    return { valid: false, reason: "max_used_margin" };
  }

  return { valid: true, reason: null };
}

function ensurePaperAccount(performance, paperConfig = null) {
  performance.paperAccount = normalizePaperAccount(performance.paperAccount);
  const account = performance.paperAccount;

  if (paperConfig && account.initialBalance === null) {
    account.initialBalance = Number(paperConfig.initialBalance) || 0;
  }

  if (account.balance === null) {
    account.balance = account.initialBalance ?? 0;
  }

  account.usedMargin = performance.paperTrades
    .filter((trade) => !trade.outcome)
    .reduce((sum, trade) => sum + (Number(trade.remainingMargin) || 0), 0);

  return account;
}

function getAvailablePaperBalance(account) {
  return (Number(account.balance) || 0) - (Number(account.usedMargin) || 0);
}

function getLiquidationPrice(trade) {
  if (!trade.positionNotional || !trade.leverage || !trade.entry) return null;

  const liquidationMove = Math.max(0, 1 / trade.leverage - (trade.maintenanceMarginPercent || 0) / 100);
  if (trade.direction === "BUY") return trade.entry * (1 - liquidationMove);
  return trade.entry * (1 + liquidationMove);
}

function getTradeRisk(trade) {
  return Math.abs(trade.entry - trade.sl);
}

function getPnlPercent(trade, exit) {
  return trade.direction === "BUY"
    ? (exit - trade.entry) / trade.entry * 100
    : (trade.entry - exit) / trade.entry * 100;
}

function getRMultiple(trade, exit) {
  const risk = getTradeRisk(trade);
  if (!risk) return 0;
  return trade.direction === "BUY" ? (exit - trade.entry) / risk : (trade.entry - exit) / risk;
}

function getTargetExitPortion(trade, target) {
  const value = Number(trade[`${target}ExitPortion`]);
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function getRemainingExitPortion(trade) {
  const realized = [
    trade.tp1Hit ? getTargetExitPortion(trade, "tp1") : 0,
    trade.tp2Hit ? getTargetExitPortion(trade, "tp2") : 0,
    trade.tp3Hit ? getTargetExitPortion(trade, "tp3") : 0
  ].reduce((sum, value) => sum + value, 0);

  return Math.max(0, 1 - realized);
}

function realizePortion(trade, exit, portion, paperAccount = null) {
  const safePortion = Math.max(0, Math.min(1, Number(portion) || 0));
  const pnlPercent = (getPnlPercent(trade, exit) - (trade.feePercent || 0) - (trade.slippagePercent || 0)) * safePortion;
  const realizedR = getRMultiple(trade, exit) * safePortion;
  const notionalPortion = (Number(trade.positionNotional) || 0) * safePortion;
  const exitFeeUsdt = notionalPortion * (Number(trade.feePercent) || 0) / 100;
  const slippageUsdt = notionalPortion * (Number(trade.slippagePercent) || 0) / 100;
  const grossPnlUsdt = notionalPortion * getPnlPercent(trade, exit) / 100;
  const pnlUsdt = grossPnlUsdt - exitFeeUsdt - slippageUsdt;
  const releasedMargin = (Number(trade.initialMargin) || 0) * safePortion;

  trade.realizedPnlPercent = (Number(trade.realizedPnlPercent) || 0) + pnlPercent;
  trade.realizedR = (Number(trade.realizedR) || 0) + realizedR;
  trade.realizedPnlUsdt = (Number(trade.realizedPnlUsdt) || 0) + pnlUsdt;
  trade.totalFeesUsdt = (Number(trade.totalFeesUsdt) || 0) + exitFeeUsdt;
  trade.remainingNotional = Math.max(0, (Number(trade.remainingNotional) || 0) - notionalPortion);
  trade.remainingMargin = Math.max(0, (Number(trade.remainingMargin) || 0) - releasedMargin);

  if (paperAccount && notionalPortion > 0) {
    paperAccount.balance += pnlUsdt;
    paperAccount.usedMargin = Math.max(0, (Number(paperAccount.usedMargin) || 0) - releasedMargin);
    paperAccount.realizedPnl += pnlUsdt;
    paperAccount.dailyPnl += pnlUsdt;
    paperAccount.totalFees += exitFeeUsdt;
    refreshPaperRiskState(paperAccount);
    recordEquityPoint(paperAccount);
  }

  return {
    pnlPercent,
    realizedR,
    pnlUsdt,
    feeUsdt: exitFeeUsdt,
    slippageUsdt,
    releasedMargin,
    cumulativePnlPercent: trade.realizedPnlPercent,
    cumulativeR: trade.realizedR
  };
}

function closeTrade(trade, { status, outcome, exit, candleTime, conservativeSameCandle = false }, paperAccount = null) {
  const remainingPortion = getRemainingExitPortion(trade);
  const realization = realizePortion(trade, exit, remainingPortion, paperAccount);

  return {
    ...trade,
    status,
    outcome,
    exit,
    pnlPercent: trade.realizedPnlPercent,
    realizedR: trade.realizedR,
    closedAt: candleTime,
    conservativeSameCandle,
    exitPortion: remainingPortion,
    eventPnlPercent: realization.pnlPercent,
    eventR: realization.realizedR,
    eventPnlUsdt: realization.pnlUsdt,
    eventFeeUsdt: realization.feeUsdt,
    eventSlippageUsdt: realization.slippageUsdt,
    realizedPnlUsdt: trade.realizedPnlUsdt,
    totalFeesUsdt: trade.totalFeesUsdt
  };
}

function liquidateTrade(trade, candleTime, paperAccount = null) {
  const remainingPortion = getRemainingExitPortion(trade);
  const remainingMargin = Number(trade.remainingMargin) || 0;
  const liquidationLoss = -remainingMargin;

  trade.realizedPnlUsdt = (Number(trade.realizedPnlUsdt) || 0) + liquidationLoss;
  trade.realizedR = (Number(trade.realizedR) || 0) + getRMultiple(trade, trade.liquidationPrice) * remainingPortion;
  trade.realizedPnlPercent = (Number(trade.realizedPnlPercent) || 0) + getPnlPercent(trade, trade.liquidationPrice) * remainingPortion;
  trade.remainingNotional = 0;
  trade.remainingMargin = 0;

  if (paperAccount) {
    paperAccount.balance += liquidationLoss;
    paperAccount.usedMargin = Math.max(0, (Number(paperAccount.usedMargin) || 0) - remainingMargin);
    paperAccount.realizedPnl += liquidationLoss;
    paperAccount.dailyPnl += liquidationLoss;
    paperAccount.totalLiquidations += 1;
    refreshPaperRiskState(paperAccount);
    recordEquityPoint(paperAccount);
  }

  return {
    ...trade,
    status: "LIQUIDATED",
    outcome: "LIQUIDATED",
    exit: trade.liquidationPrice,
    pnlPercent: trade.realizedPnlPercent,
    realizedR: trade.realizedR,
    closedAt: candleTime,
    exitPortion: remainingPortion,
    eventPnlPercent: getPnlPercent(trade, trade.liquidationPrice) * remainingPortion,
    eventR: getRMultiple(trade, trade.liquidationPrice) * remainingPortion,
    eventPnlUsdt: liquidationLoss,
    eventFeeUsdt: 0,
    eventSlippageUsdt: 0,
    realizedPnlUsdt: trade.realizedPnlUsdt,
    totalFeesUsdt: trade.totalFeesUsdt
  };
}

function updateTradeList(trades, key, candles, { closeOnFinal = true, maxOpenCandles = 0, paperAccount = null } = {}) {
  const remainingTrades = [];
  const closedTrades = [];
  const events = [];
  let changed = false;

  for (const trade of trades.map(normalizeTrade)) {
    if (trade.key !== key) {
      remainingTrades.push(trade);
      continue;
    }

    let closedTrade = null;
    let lastCheckedCandleTime = trade.lastCheckedCandleTime ?? trade.openedAt;
    const previousCheckedCandleTime = lastCheckedCandleTime;

    for (const candle of candles) {
      if (candle.timestamp <= lastCheckedCandleTime || candle.timestamp <= trade.openedAt) continue;

      lastCheckedCandleTime = candle.timestamp;
      trade.openCandleCount = (Number(trade.openCandleCount) || 0) + 1;

      const hitSl = trade.direction === "BUY" ? candle.low <= trade.sl : candle.high >= trade.sl;
      const hitLiquidation = trade.liquidationPrice
        ? trade.direction === "BUY" ? candle.low <= trade.liquidationPrice : candle.high >= trade.liquidationPrice
        : false;
      const hitTp1 = trade.direction === "BUY" ? candle.high >= trade.tp1 : candle.low <= trade.tp1;
      const hitTp2 = trade.direction === "BUY" ? candle.high >= trade.tp2 : candle.low <= trade.tp2;
      const hitTp3 = trade.direction === "BUY" ? candle.high >= trade.tp3 : candle.low <= trade.tp3;

      if (hitLiquidation) {
        closedTrade = liquidateTrade(trade, candle.timestamp, paperAccount);
        closedTrade.lastCheckedCandleTime = lastCheckedCandleTime;
        events.push({ type: "LIQUIDATED", trade: closedTrade, candleTime: candle.timestamp });
        changed = true;
        break;
      }

      if (hitSl) {
        closedTrade = closeTrade(trade, {
          status: "SL_HIT",
          outcome: "SL",
          exit: trade.sl,
          candleTime: candle.timestamp,
          conservativeSameCandle: hitTp1 || hitTp2 || hitTp3
        }, paperAccount);
        closedTrade.lastCheckedCandleTime = lastCheckedCandleTime;
        events.push({ type: "SL_HIT", trade: closedTrade, candleTime: candle.timestamp });
        changed = true;
        break;
      }

      for (const [field, status, target] of [["tp1Hit", "TP1_HIT", "tp1"], ["tp2Hit", "TP2_HIT", "tp2"], ["tp3Hit", "TP3_HIT", "tp3"]]) {
        const hit = target === "tp1" ? hitTp1 : target === "tp2" ? hitTp2 : hitTp3;
        if (hit && !trade[field]) {
          const portion = getTargetExitPortion(trade, target);
          const realization = realizePortion(trade, trade[target], portion, paperAccount);
          trade[field] = true;
          trade.status = status;
          if (target === "tp1" && paperAccount && optionsBreakEvenEnabled(paperAccount)) {
            trade.sl = trade.entry;
            trade.slMovedToBreakEven = true;
          }
          if (target === "tp2" && paperAccount && optionsTrailEnabled(paperAccount)) {
            trade.sl = trade.direction === "BUY"
              ? Math.max(trade.sl, trade.tp1)
              : Math.min(trade.sl, trade.tp1);
            trade.trailingStopActive = true;
          }
          events.push({
            type: status,
            trade: {
              ...trade,
              exit: trade[target],
              exitPortion: portion,
              eventPnlPercent: realization.pnlPercent,
              eventR: realization.realizedR,
              eventPnlUsdt: realization.pnlUsdt,
              eventFeeUsdt: realization.feeUsdt,
              eventSlippageUsdt: realization.slippageUsdt,
              pnlPercent: trade.realizedPnlPercent,
              realizedPnlUsdt: trade.realizedPnlUsdt,
              totalFeesUsdt: trade.totalFeesUsdt
            },
            candleTime: candle.timestamp
          });
          changed = true;
        }
      }

      if (closeOnFinal && trade.tp3Hit) {
        closedTrade = closeTrade(trade, {
          status: "TP3_HIT",
          outcome: "TP3",
          exit: trade.tp3,
          candleTime: candle.timestamp
        }, paperAccount);
        closedTrade.lastCheckedCandleTime = lastCheckedCandleTime;
        break;
      }

      if (maxOpenCandles > 0 && trade.openCandleCount >= maxOpenCandles) {
        closedTrade = closeTrade(trade, {
          status: "EXPIRED",
          outcome: "EXPIRED",
          exit: candle.close,
          candleTime: candle.timestamp
        }, paperAccount);
        closedTrade.lastCheckedCandleTime = lastCheckedCandleTime;
        events.push({ type: "EXPIRED", trade: closedTrade, candleTime: candle.timestamp });
        changed = true;
        break;
      }
    }

    if (closedTrade) {
      closedTrades.push(closedTrade);
      changed = true;
    } else {
      trade.lastCheckedCandleTime = lastCheckedCandleTime;
      remainingTrades.push(trade);
      if (lastCheckedCandleTime !== previousCheckedCandleTime) changed = true;
    }
  }

  return { changed, remainingTrades, closedTrades, events };
}

export function updateTradeOutcomes(state, key, candles, options = {}) {
  const performance = getPerformanceState(state);
  const result = updateTradeList(performance.openTrades, key, candles, options);
  performance.openTrades = result.remainingTrades;
  performance.closedTrades.push(...result.closedTrades);
  return { changed: result.changed, events: result.events };
}

export function updatePaperTradeOutcomes(state, key, candles, options = {}) {
  const performance = getPerformanceState(state);
  const paperAccount = ensurePaperAccount(performance, options.paperConfig || null);
  paperAccount.exitRules = {
    breakEvenAfterTp1: Boolean(options.paperConfig?.breakEvenAfterTp1),
    trailAfterTp2: Boolean(options.paperConfig?.trailAfterTp2)
  };
  const result = updateTradeList(performance.paperTrades, key, candles, { ...options, paperAccount });
  delete paperAccount.exitRules;
  performance.paperTrades = [...result.remainingTrades, ...result.closedTrades];
  return { changed: result.changed, events: result.events.map((event) => ({ ...event, paper: true })) };
}

function optionsBreakEvenEnabled(paperAccount) {
  return Boolean(paperAccount?.exitRules?.breakEvenAfterTp1);
}

function optionsTrailEnabled(paperAccount) {
  return Boolean(paperAccount?.exitRules?.trailAfterTp2);
}

export function recordSignalDecision(state, decision, limit = 1000) {
  const normalized = normalizeState(state);
  normalized.research.signalDecisions.push({
    at: Date.now(),
    ...decision
  });
  if (normalized.research.signalDecisions.length > limit) {
    normalized.research.signalDecisions = normalized.research.signalDecisions.slice(-limit);
  }
}

export function recordMarketSnapshot(state, snapshot, limit = 2000) {
  const normalized = normalizeState(state);
  normalized.research.marketSnapshots.push({
    at: Date.now(),
    ...snapshot
  });
  if (normalized.research.marketSnapshots.length > limit) {
    normalized.research.marketSnapshots = normalized.research.marketSnapshots.slice(-limit);
  }
}
