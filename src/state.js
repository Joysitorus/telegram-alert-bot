import fs from "fs";
import path from "path";

function createDefaultPerformanceState() {
  return {
    openTrades: [],
    closedTrades: [],
    paperTrades: [],
    lastWeeklyReportKey: null,
    lastMonthlyReportKey: null,
    lastPaperReportKey: null
  };
}

export function createDefaultState() {
  return {
    pairs: {},
    performance: createDefaultPerformanceState(),
    runtime: {
      paused: false,
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
  if (!Object.hasOwn(normalized, "tp1Hit")) normalized.tp1Hit = ["TP1_HIT", "TP2_HIT", "TP3_HIT"].includes(normalized.status);
  if (!Object.hasOwn(normalized, "tp2Hit")) normalized.tp2Hit = ["TP2_HIT", "TP3_HIT"].includes(normalized.status) || normalized.outcome === "TP2";
  if (!Object.hasOwn(normalized, "tp3Hit")) normalized.tp3Hit = normalized.status === "TP3_HIT" || normalized.outcome === "TP3";
  if (!Object.hasOwn(normalized, "realizedR")) normalized.realizedR = 0;
  return normalized;
}

export function normalizeState(state) {
  const normalized = state && typeof state === "object" ? state : createDefaultState();

  if (!normalized.pairs) normalized.pairs = {};
  if (!normalized.performance) normalized.performance = createDefaultPerformanceState();
  if (!normalized.performance.openTrades) normalized.performance.openTrades = [];
  if (!normalized.performance.closedTrades) normalized.performance.closedTrades = [];
  if (!normalized.performance.paperTrades) normalized.performance.paperTrades = [];
  if (!Object.hasOwn(normalized.performance, "lastWeeklyReportKey")) normalized.performance.lastWeeklyReportKey = null;
  if (!Object.hasOwn(normalized.performance, "lastMonthlyReportKey")) normalized.performance.lastMonthlyReportKey = null;
  if (!Object.hasOwn(normalized.performance, "lastPaperReportKey")) normalized.performance.lastPaperReportKey = null;
  normalized.performance.openTrades = normalized.performance.openTrades.map(normalizeTrade);
  normalized.performance.closedTrades = normalized.performance.closedTrades.map(normalizeTrade);
  normalized.performance.paperTrades = normalized.performance.paperTrades.map(normalizeTrade);

  if (!normalized.runtime) normalized.runtime = {};
  if (!Object.hasOwn(normalized.runtime, "paused")) normalized.runtime.paused = false;
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
    symbol: signal.symbol,
    timeframe: signal.timeframe,
    direction: signal.direction,
    directionValue: signal.directionValue,
    entry: signal.entry,
    sl: signal.sl,
    tp1: signal.tp1,
    tp2: signal.tp2,
    tp3: signal.tp3,
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

    return normalizeState(parsed);
  } catch (error) {
    console.warn(`Gagal membaca state file, membuat state baru. Error: ${error.message}`);
    return createDefaultState();
  }
}

export function getPerformanceState(state) {
  return normalizeState(state).performance;
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
  trade.feePercent = paperConfig.feePercent || 0;
  trade.slippagePercent = paperConfig.slippagePercent || 0;

  if (!performance.paperTrades.some((item) => item.id === trade.id)) {
    performance.paperTrades.push(trade);
    return true;
  }

  return false;
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

function updateTradeList(trades, key, candles, { closeOnFinal = true } = {}) {
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

      const hitSl = trade.direction === "BUY" ? candle.low <= trade.sl : candle.high >= trade.sl;
      const hitTp1 = trade.direction === "BUY" ? candle.high >= trade.tp1 : candle.low <= trade.tp1;
      const hitTp2 = trade.direction === "BUY" ? candle.high >= trade.tp2 : candle.low <= trade.tp2;
      const hitTp3 = trade.direction === "BUY" ? candle.high >= trade.tp3 : candle.low <= trade.tp3;

      if (hitSl) {
        const pnlPercent = getPnlPercent(trade, trade.sl) - (trade.feePercent || 0) - (trade.slippagePercent || 0);
        closedTrade = {
          ...trade,
          status: "SL_HIT",
          outcome: "SL",
          exit: trade.sl,
          pnlPercent,
          realizedR: getRMultiple(trade, trade.sl),
          closedAt: candle.timestamp,
          lastCheckedCandleTime,
          conservativeSameCandle: hitTp1 || hitTp2 || hitTp3
        };
        events.push({ type: "SL_HIT", trade: closedTrade, candleTime: candle.timestamp });
        changed = true;
        break;
      }

      for (const [field, status, target] of [["tp1Hit", "TP1_HIT", "tp1"], ["tp2Hit", "TP2_HIT", "tp2"], ["tp3Hit", "TP3_HIT", "tp3"]]) {
        const hit = target === "tp1" ? hitTp1 : target === "tp2" ? hitTp2 : hitTp3;
        if (hit && !trade[field]) {
          trade[field] = true;
          trade.status = status;
          trade.realizedR = getRMultiple(trade, trade[target]);
          events.push({ type: status, trade: { ...trade, exit: trade[target] }, candleTime: candle.timestamp });
          changed = true;
        }
      }

      if (closeOnFinal && trade.tp3Hit) {
        const pnlPercent = getPnlPercent(trade, trade.tp3) - (trade.feePercent || 0) - (trade.slippagePercent || 0);
        closedTrade = {
          ...trade,
          status: "TP3_HIT",
          outcome: "TP3",
          exit: trade.tp3,
          pnlPercent,
          realizedR: getRMultiple(trade, trade.tp3),
          closedAt: candle.timestamp,
          lastCheckedCandleTime
        };
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

export function updateTradeOutcomes(state, key, candles) {
  const performance = getPerformanceState(state);
  const result = updateTradeList(performance.openTrades, key, candles);
  performance.openTrades = result.remainingTrades;
  performance.closedTrades.push(...result.closedTrades);
  return { changed: result.changed, events: result.events };
}

export function updatePaperTradeOutcomes(state, key, candles) {
  const performance = getPerformanceState(state);
  const result = updateTradeList(performance.paperTrades, key, candles);
  performance.paperTrades = [...result.remainingTrades, ...result.closedTrades];
  return { changed: result.changed, events: result.events.map((event) => ({ ...event, paper: true })) };
}
