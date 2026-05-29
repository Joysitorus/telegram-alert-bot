import ccxt from "ccxt";
import { fileURLToPath } from "url";
import { config, getStrategyConfigForSymbol } from "./config.js";
import { createStateStore } from "./storage.js";
import { analyzeSymbol } from "./strategy.js";
import {
  addPaperTrade,
  createDefaultState,
  getPairState,
  getPerformanceState,
  updatePairState,
  updatePaperTradeOutcomes
} from "./state.js";

function toCandle(raw) {
  return {
    timestamp: raw[0],
    open: Number(raw[1]),
    high: Number(raw[2]),
    low: Number(raw[3]),
    close: Number(raw[4]),
    volume: Number(raw[5])
  };
}

async function fetchReplayCandles(exchange, symbol) {
  const since = process.env.REPLAY_SINCE ? exchange.parse8601(process.env.REPLAY_SINCE) : undefined;
  const limit = Number(process.env.REPLAY_LIMIT || config.exchange.candleLimit);
  const raw = await exchange.fetchOHLCV(symbol, config.exchange.timeframe, since, limit, {
    paginate: process.env.REPLAY_PAGINATE === "true",
    paginationCalls: Number(process.env.REPLAY_PAGINATION_CALLS || 5)
  });
  return raw.map(toCandle);
}

async function loadReplayCandlesFromDatabase(stateStore, exchange, symbol) {
  const since = process.env.REPLAY_SINCE ? exchange.parse8601(process.env.REPLAY_SINCE) : null;
  const until = process.env.REPLAY_UNTIL ? exchange.parse8601(process.env.REPLAY_UNTIL) : null;
  return stateStore.loadCandlesRange({
    exchangeId: config.exchange.id,
    marketType: config.exchange.marketType,
    symbol,
    timeframe: config.exchange.timeframe,
    since,
    until,
    limit: config.marketData.replayLimit
  });
}

function roundMetric(value, digits = 4) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Number(number.toFixed(digits));
}

function incrementCounter(counter, key, by = 1) {
  const safeKey = key || "unknown";
  counter[safeKey] = (counter[safeKey] || 0) + by;
}

function getTradeWin(trade) {
  return trade.outcome === "TP3" || trade.tp2Hit || Number(trade.realizedR) > 0;
}

function getMaxDrawdownFromEquityCurve(equityCurve = []) {
  let peak = null;
  let maxDrawdownUsdt = 0;
  let maxDrawdownPercent = 0;

  for (const point of equityCurve) {
    const balance = Number(point.balance);
    if (!Number.isFinite(balance)) continue;

    if (peak === null || balance > peak) peak = balance;
    if (!peak || peak <= 0) continue;

    const drawdownUsdt = peak - balance;
    const drawdownPercent = drawdownUsdt / peak * 100;
    maxDrawdownUsdt = Math.max(maxDrawdownUsdt, drawdownUsdt);
    maxDrawdownPercent = Math.max(maxDrawdownPercent, drawdownPercent);
  }

  return {
    maxDrawdownUsdt: roundMetric(maxDrawdownUsdt, 4),
    maxDrawdownPercent: roundMetric(maxDrawdownPercent, 4)
  };
}

function getMaxDrawdownFromTradeR(trades) {
  const closed = trades
    .filter((trade) => trade.outcome)
    .sort((a, b) => {
      const aTime = Number(a.closedAt ?? a.openedAt ?? 0);
      const bTime = Number(b.closedAt ?? b.openedAt ?? 0);
      return aTime - bTime;
    });
  let equityR = 0;
  let peakR = 0;
  let maxDrawdownR = 0;

  for (const trade of closed) {
    equityR += Number(trade.realizedR) || 0;
    peakR = Math.max(peakR, equityR);
    maxDrawdownR = Math.max(maxDrawdownR, peakR - equityR);
  }

  return { maxDrawdownR: roundMetric(maxDrawdownR, 4) };
}

function summarizeTrades(trades) {
  const closed = trades.filter((trade) => trade.outcome);
  const wins = closed.filter(getTradeWin).length;
  const losses = closed.filter((trade) => trade.outcome === "SL").length;
  const liquidations = closed.filter((trade) => trade.outcome === "LIQUIDATED").length;
  const totalR = closed.reduce((sum, trade) => sum + (Number(trade.realizedR) || 0), 0);
  const realizedPnlUsdt = closed.reduce((sum, trade) => sum + (Number(trade.realizedPnlUsdt) || 0), 0);
  const outcomes = {};

  for (const trade of closed) {
    incrementCounter(outcomes, trade.outcome);
  }

  return {
    totalTrades: trades.length,
    closedTrades: closed.length,
    openTrades: trades.length - closed.length,
    wins,
    losses,
    liquidations,
    winrate: roundMetric(closed.length ? wins / closed.length * 100 : 0, 2),
    averageR: roundMetric(closed.length ? totalR / closed.length : 0, 4),
    totalR: roundMetric(totalR, 4),
    realizedPnlUsdt: roundMetric(realizedPnlUsdt, 4),
    outcomes
  };
}

function summarizeReplayTradeSet(trades) {
  return {
    ...summarizeTrades(trades),
    ...getMaxDrawdownFromTradeR(trades)
  };
}

function getRejectedReasonSummary(state) {
  const account = getPerformanceState(state).paperAccount || {};
  const summary = {};

  if (account.lastRejectReason && account.rejectedTrades > 0) {
    summary[account.lastRejectReason] = Number(account.rejectedTrades) || 0;
  }

  return {
    total: Number(account.rejectedTrades) || 0,
    reasons: summary
  };
}

function getTimestampIso(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value)) return null;
  return new Date(value).toISOString();
}

function clampWalkForwardRatio(value) {
  const ratio = Number(value);
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) return 0.7;
  return ratio;
}

function getWalkForwardWindows(candles, trainRatio) {
  const sortedCandles = [...(candles || [])]
    .filter((candle) => Number.isFinite(Number(candle.timestamp)))
    .sort((a, b) => Number(a.timestamp) - Number(b.timestamp));

  if (sortedCandles.length < 2) {
    return {
      train: null,
      test: null
    };
  }

  const splitIndex = Math.min(
    sortedCandles.length - 1,
    Math.max(1, Math.floor(sortedCandles.length * trainRatio))
  );
  const trainStart = sortedCandles[0];
  const trainEnd = sortedCandles[splitIndex - 1];
  const testStart = sortedCandles[splitIndex];
  const testEnd = sortedCandles.at(-1);

  return {
    train: {
      startTime: trainStart.timestamp,
      endTime: trainEnd.timestamp,
      startIso: getTimestampIso(trainStart.timestamp),
      endIso: getTimestampIso(trainEnd.timestamp),
      candleCount: splitIndex
    },
    test: {
      startTime: testStart.timestamp,
      endTime: testEnd.timestamp,
      startIso: getTimestampIso(testStart.timestamp),
      endIso: getTimestampIso(testEnd.timestamp),
      candleCount: sortedCandles.length - splitIndex
    }
  };
}

function splitTradesByWindow(trades, windows) {
  const train = [];
  const test = [];
  const unassigned = [];

  for (const trade of trades) {
    const openedAt = Number(trade.openedAt ?? trade.signalCandleTime);
    if (!Number.isFinite(openedAt) || !windows.train || !windows.test) {
      unassigned.push(trade);
    } else if (openedAt <= windows.train.endTime) {
      train.push(trade);
    } else if (openedAt >= windows.test.startTime) {
      test.push(trade);
    } else {
      unassigned.push(trade);
    }
  }

  return { train, test, unassigned };
}

function compareReplaySegments(train, test) {
  return {
    winrateDelta: roundMetric(test.winrate - train.winrate, 2),
    averageRDelta: roundMetric(test.averageR - train.averageR, 4),
    totalRDelta: roundMetric(test.totalR - train.totalR, 4),
    maxDrawdownRDelta: roundMetric(test.maxDrawdownR - train.maxDrawdownR, 4),
    closedTradeDelta: test.closedTrades - train.closedTrades
  };
}

function summarizeWalkForward(state, options = {}) {
  const performance = getPerformanceState(state);
  const paperTrades = performance.paperTrades;
  const candlesBySymbol = options.candlesBySymbol || {};
  const trainRatio = clampWalkForwardRatio(options.trainRatio);
  const globalTrainTrades = [];
  const globalTestTrades = [];
  const globalUnassignedTrades = [];
  const bySymbol = {};

  for (const [symbol, candles] of Object.entries(candlesBySymbol).sort(([a], [b]) => a.localeCompare(b))) {
    const symbolTrades = paperTrades.filter((trade) => (trade.symbol || "unknown") === symbol);
    const windows = getWalkForwardWindows(candles, trainRatio);
    const split = splitTradesByWindow(symbolTrades, windows);
    const train = summarizeReplayTradeSet(split.train);
    const test = summarizeReplayTradeSet(split.test);

    globalTrainTrades.push(...split.train);
    globalTestTrades.push(...split.test);
    globalUnassignedTrades.push(...split.unassigned);

    bySymbol[symbol] = {
      trainWindow: windows.train,
      testWindow: windows.test,
      train,
      test,
      comparison: compareReplaySegments(train, test),
      unassignedTrades: split.unassigned.length
    };
  }

  const train = summarizeReplayTradeSet(globalTrainTrades);
  const test = summarizeReplayTradeSet(globalTestTrades);

  return {
    method: "single_pass_per_symbol_time_split",
    trainRatio,
    testRatio: roundMetric(1 - trainRatio, 4),
    global: {
      train,
      test,
      comparison: compareReplaySegments(train, test),
      unassignedTrades: globalUnassignedTrades.length
    },
    bySymbol
  };
}

function getReplayWalkForwardRatio() {
  return clampWalkForwardRatio(process.env.REPLAY_WALK_FORWARD_RATIO ?? process.env.REPLAY_TRAIN_RATIO ?? 0.7);
}

export function summarizeReplay(state, options = {}) {
  const performance = getPerformanceState(state);
  const paperTrades = performance.paperTrades;
  const paperAccount = performance.paperAccount || {};
  const bySymbol = {};

  for (const trade of paperTrades) {
    const symbol = trade.symbol || "unknown";
    if (!bySymbol[symbol]) bySymbol[symbol] = [];
    bySymbol[symbol].push(trade);
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    global: {
      ...summarizeTrades(paperTrades),
      ...getMaxDrawdownFromEquityCurve(paperAccount.equityCurve || []),
      rejected: getRejectedReasonSummary(state)
    },
    bySymbol: Object.fromEntries(
      Object.entries(bySymbol)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([symbol, trades]) => [symbol, summarizeTrades(trades)])
    )
  };

  if (options.walkForward) {
    summary.walkForward = summarizeWalkForward(state, options.walkForward);
  }

  return summary;
}

async function main() {
  const ExchangeClass = ccxt[config.exchange.id];
  if (!ExchangeClass) throw new Error(`Exchange tidak ditemukan: ${config.exchange.id}`);

  const exchange = new ExchangeClass({
    enableRateLimit: true,
    options: { defaultType: config.exchange.marketType }
  });
  await exchange.loadMarkets();

  const state = createDefaultState();
  const useDatabase = process.env.REPLAY_SOURCE === "database" || process.env.REPLAY_USE_DB === "true";
  const stateStore = useDatabase ? createStateStore(config.runtime) : null;
  const lifecycleOptions = {
    maxOpenCandles: config.performance.tradeExpiryCandles,
    paperConfig: config.paper
  };
  const candlesBySymbol = {};

  for (const symbol of config.exchange.symbols) {
    const key = `${config.exchange.id}:${symbol}:${config.exchange.timeframe}`;
    const strategyConfig = getStrategyConfigForSymbol(symbol);
    const candles = useDatabase
      ? await loadReplayCandlesFromDatabase(stateStore, exchange, symbol)
      : await fetchReplayCandles(exchange, symbol);
    candlesBySymbol[symbol] = candles;

    if (useDatabase && candles.length === 0) {
      console.warn(`Tidak ada candle database untuk ${symbol} ${config.exchange.timeframe}.`);
      continue;
    }

    for (let index = 250; index < candles.length; index += 1) {
      const window = candles.slice(0, index + 1);
      updatePaperTradeOutcomes(state, key, window, lifecycleOptions);
      const analysis = analyzeSymbol({
        exchangeId: config.exchange.id,
        symbol,
        timeframe: config.exchange.timeframe,
        candles: window,
        strategyConfig,
        pairState: getPairState(state, key)
      });

      if (analysis.hasSignal) {
        updatePairState(state, key, analysis.signal);
        addPaperTrade(state, key, analysis.signal, config.paper);
      }
    }

    updatePaperTradeOutcomes(state, key, candles, lifecycleOptions);
  }

  console.log(JSON.stringify(summarizeReplay(state, {
    walkForward: {
      candlesBySymbol,
      trainRatio: getReplayWalkForwardRatio()
    }
  }), null, 2));
  if (stateStore) await stateStore.close();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
