import ccxt from "ccxt";
import { fileURLToPath } from "url";
import { config, getConfigHash, getStrategyConfigForSymbol } from "./config.js";
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
import { parseJson, toBoolean, toNumber } from "./utils.js";

const sweepKeyAliases = {
  MIN_CONFIRM: "minConfirm",
  MIN_RR: "minRR",
  ENTRY_MODE: "entryMode",
  MIN_VOLUME_RATIO: "minVolumeRatio",
  MAX_ENTRY_WICK_PERCENT: "maxEntryWickPercent",
  MIN_BREAKOUT_ATR: "minBreakoutAtr",
  MAX_BREAKOUT_EXTENSION_ATR: "maxBreakoutExtensionAtr",
  MIN_CANDLE_BODY_PERCENT: "minCandleBodyPercent",
  REJECT_FALLBACK_LIQUIDITY_TARGET: "rejectFallbackLiquidityTarget",
  REQUIRE_ORDER_BLOCK: "requireOrderBlock",
  MARKET_REGIME_FILTER: "marketRegimeFilter"
};

const defaultSweepSearchSpace = {
  minConfirm: [5, 6, 7],
  minRR: [2, 2.5, 3, 4],
  entryMode: ["breakout_close", "breakout_retest", "pullback_trend"],
  minVolumeRatio: [0, 1.2, 1.5],
  maxEntryWickPercent: [25, 35, 50],
  minBreakoutAtr: [0, 0.15],
  minCandleBodyPercent: [0, 45],
  rejectFallbackLiquidityTarget: [false, true]
};

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

function normalizeSweepKey(key) {
  return sweepKeyAliases[key] || sweepKeyAliases[String(key).toUpperCase()] || key;
}

function normalizeSweepSearchSpace(input) {
  const normalized = {};

  for (const [rawKey, rawValues] of Object.entries(input || {})) {
    const key = normalizeSweepKey(rawKey);
    const values = Array.isArray(rawValues) ? rawValues : [rawValues];
    const deduped = [];

    for (const value of values) {
      const signature = JSON.stringify(value);
      if (!deduped.some((item) => JSON.stringify(item) === signature)) {
        deduped.push(value);
      }
    }

    if (deduped.length > 0) normalized[key] = deduped;
  }

  return normalized;
}

function getSweepSearchSpace() {
  const envSearchSpace = normalizeSweepSearchSpace(parseJson(process.env.REPLAY_SWEEP_SPACE_JSON, null));
  if (Object.keys(envSearchSpace).length > 0) return envSearchSpace;
  return normalizeSweepSearchSpace(defaultSweepSearchSpace);
}

function cartesianProduct(searchSpace) {
  const entries = Object.entries(searchSpace);
  let combinations = [{}];

  for (const [key, values] of entries) {
    combinations = combinations.flatMap((combo) => values.map((value) => ({
      ...combo,
      [key]: value
    })));
  }

  return combinations;
}

function getSweepConfigId(parameters, index) {
  const hash = getConfigHash(parameters).slice(0, 8);
  return `sweep_${String(index + 1).padStart(4, "0")}_${hash}`;
}

function getBaselineSweepParameters() {
  const baseline = {};
  for (const key of Object.keys(getSweepSearchSpace())) {
    baseline[key] = config.strategy[key];
  }
  return baseline;
}

function hasSameParameters(a, b) {
  return getConfigHash(a) === getConfigHash(b);
}

function selectSweepCombinations(combinations, maxConfigs) {
  if (combinations.length <= maxConfigs) return combinations;
  if (maxConfigs <= 1) return [combinations[0]];

  const selected = [];
  const used = new Set();

  for (let index = 0; index < maxConfigs; index += 1) {
    const sourceIndex = Math.floor(index * (combinations.length - 1) / (maxConfigs - 1));
    const combo = combinations[sourceIndex];
    const hash = getConfigHash(combo);
    if (!used.has(hash)) {
      selected.push(combo);
      used.add(hash);
    }
  }

  for (const combo of combinations) {
    if (selected.length >= maxConfigs) break;
    const hash = getConfigHash(combo);
    if (!used.has(hash)) {
      selected.push(combo);
      used.add(hash);
    }
  }

  return selected;
}

function buildSweepConfigurations() {
  const searchSpace = getSweepSearchSpace();
  const maxConfigs = toNumber(process.env.REPLAY_SWEEP_MAX_CONFIGS, 120, { min: 1, max: 10000 });
  const baseline = getBaselineSweepParameters();
  const combinations = cartesianProduct(searchSpace);
  const sampled = selectSweepCombinations(combinations, maxConfigs);
  const withBaseline = sampled.some((combo) => hasSameParameters(combo, baseline))
    ? sampled
    : [baseline, ...sampled.slice(0, Math.max(0, maxConfigs - 1))];

  return {
    searchSpace,
    totalCombinations: combinations.length,
    evaluatedCombinations: withBaseline.length,
    maxConfigs,
    configurations: withBaseline.map((parameters, index) => ({
      id: getSweepConfigId(parameters, index),
      parameters
    }))
  };
}

function getTradeCountPenalty(closedTrades, minimumTrades) {
  if (minimumTrades <= 0 || closedTrades >= minimumTrades) return 0;
  return (minimumTrades - closedTrades) * 0.75;
}

function scoreSweepResult(walkForwardGlobal, options = {}) {
  const train = walkForwardGlobal.train;
  const test = walkForwardGlobal.test;
  const minTestTrades = Number(options.minTestTrades) || 0;
  const trainTestGap = Math.max(0, train.averageR - test.averageR);
  const drawdownPenalty = test.maxDrawdownR * 0.35;
  const tradePenalty = getTradeCountPenalty(test.closedTrades, minTestTrades);

  return roundMetric(
    test.averageR * 3 +
    test.totalR * 0.45 +
    test.winrate * 0.01 -
    drawdownPenalty -
    trainTestGap * 1.5 -
    tradePenalty,
    4
  );
}

function getSweepFlags(walkForwardGlobal, options = {}) {
  const flags = [];
  const train = walkForwardGlobal.train;
  const test = walkForwardGlobal.test;
  const minTestTrades = Number(options.minTestTrades) || 0;

  if (test.closedTrades < minTestTrades) flags.push("low_test_trade_count");
  if (train.averageR > 0 && test.averageR <= 0) flags.push("train_positive_test_nonpositive");
  if (train.closedTrades > 0 && test.closedTrades === 0) flags.push("no_oos_closed_trades");
  if (train.averageR - test.averageR >= 1) flags.push("large_train_test_decay");
  if (test.maxDrawdownR > Math.max(2, Math.abs(test.totalR))) flags.push("drawdown_exceeds_test_edge");

  return flags;
}

function rankSweepResults(results, options = {}) {
  return results
    .map((result) => {
      const global = result.summary.walkForward.global;
      const symbolSegments = Object.values(result.summary.walkForward.bySymbol || {});
      const testedSymbols = symbolSegments.filter((item) => item.test.closedTrades > 0);
      const positiveSymbols = testedSymbols.filter((item) => item.test.totalR > 0);
      const positiveSymbolRatio = testedSymbols.length ? positiveSymbols.length / testedSymbols.length * 100 : 0;
      return {
        id: result.id,
        parameters: result.parameters,
        score: roundMetric(scoreSweepResult(global, options) + positiveSymbolRatio * 0.01, 4),
        train: global.train,
        test: global.test,
        comparison: global.comparison,
        positiveSymbolRatio: roundMetric(positiveSymbolRatio, 2),
        flags: getSweepFlags(global, options)
      };
    })
    .sort((a, b) => {
      return (b.score - a.score) ||
        (b.test.averageR - a.test.averageR) ||
        (a.test.maxDrawdownR - b.test.maxDrawdownR) ||
        (b.test.closedTrades - a.test.closedTrades);
    });
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

export function runReplayOnCandles(candlesBySymbol, options = {}) {
  const state = createDefaultState();
  const lifecycleOptions = {
    maxOpenCandles: config.performance.tradeExpiryCandles,
    paperConfig: config.paper
  };
  const strategyOverrides = options.strategyOverrides || {};

  for (const symbol of config.exchange.symbols) {
    const key = `${config.exchange.id}:${symbol}:${config.exchange.timeframe}`;
    const baseStrategyConfig = getStrategyConfigForSymbol(symbol);
    const tp1ExitPortion = strategyOverrides.tp1ExitPortion ?? baseStrategyConfig.tp1ExitPortion;
    const tp2ExitPortion = strategyOverrides.tp2ExitPortion ?? baseStrategyConfig.tp2ExitPortion;
    const strategyConfig = {
      ...baseStrategyConfig,
      ...strategyOverrides,
      tp3ExitPortion: strategyOverrides.tp3ExitPortion ?? Math.max(0, 1 - tp1ExitPortion - tp2ExitPortion)
    };
    const candles = candlesBySymbol[symbol] || [];

    if (candles.length === 0) continue;

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
        analysis.signal.configHash = getConfigHash({
          exchange: config.exchange,
          strategy: strategyConfig,
          paper: config.paper
        });
        updatePairState(state, key, analysis.signal);
        addPaperTrade(state, key, analysis.signal, config.paper);
      }
    }

    updatePaperTradeOutcomes(state, key, candles, lifecycleOptions);
  }

  return state;
}

export function runReplaySweep(candlesBySymbol, options = {}) {
  const sweep = buildSweepConfigurations();
  const trainRatio = clampWalkForwardRatio(options.trainRatio ?? getReplayWalkForwardRatio());
  const minTestTrades = toNumber(process.env.REPLAY_SWEEP_MIN_TEST_TRADES, 3, { min: 0, max: 100000 });
  const topLimit = toNumber(process.env.REPLAY_SWEEP_TOP, 10, { min: 1, max: 1000 });
  const results = [];

  for (const item of sweep.configurations) {
    const state = runReplayOnCandles(candlesBySymbol, { strategyOverrides: item.parameters });
    const summary = summarizeReplay(state, {
      walkForward: {
        candlesBySymbol,
        trainRatio
      }
    });

    results.push({
      id: item.id,
      parameters: item.parameters,
      summary
    });
  }

  const ranking = rankSweepResults(results, { minTestTrades });

  return {
    generatedAt: new Date().toISOString(),
    method: "bounded_grid_sweep_with_walk_forward_ranking",
    researchBasis: [
      "time_ordered_walk_forward_split",
      "bounded_grid_search",
      "oos_weighted_score",
      "train_test_decay_penalty",
      "minimum_trade_count_flag"
    ],
    searchSpace: sweep.searchSpace,
    totalCombinations: sweep.totalCombinations,
    evaluatedCombinations: sweep.evaluatedCombinations,
    maxConfigs: sweep.maxConfigs,
    trainRatio,
    testRatio: roundMetric(1 - trainRatio, 4),
    minTestTrades,
    ranking: ranking.slice(0, topLimit),
    evaluated: ranking
  };
}

async function main() {
  const ExchangeClass = ccxt[config.exchange.id];
  if (!ExchangeClass) throw new Error(`Exchange tidak ditemukan: ${config.exchange.id}`);

  const exchange = new ExchangeClass({
    enableRateLimit: true,
    options: { defaultType: config.exchange.marketType }
  });
  await exchange.loadMarkets();

  const useDatabase = process.env.REPLAY_SOURCE === "database" || process.env.REPLAY_USE_DB === "true";
  const stateStore = useDatabase ? createStateStore(config.runtime) : null;
  const candlesBySymbol = {};

  for (const symbol of config.exchange.symbols) {
    const candles = useDatabase
      ? await loadReplayCandlesFromDatabase(stateStore, exchange, symbol)
      : await fetchReplayCandles(exchange, symbol);
    candlesBySymbol[symbol] = candles;

    if (useDatabase && candles.length === 0) {
      console.warn(`Tidak ada candle database untuk ${symbol} ${config.exchange.timeframe}.`);
      continue;
    }
  }

  const trainRatio = getReplayWalkForwardRatio();
  const output = toBoolean(process.env.REPLAY_SWEEP_ENABLED, false)
    ? runReplaySweep(candlesBySymbol, { trainRatio })
    : summarizeReplay(runReplayOnCandles(candlesBySymbol), {
      walkForward: {
        candlesBySymbol,
        trainRatio
      }
    });

  console.log(JSON.stringify(output, null, 2));
  if (stateStore) await stateStore.close();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
