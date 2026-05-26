import ccxt from "ccxt";
import { runCommandLoop } from "./commands.js";
import { config, getConfigHash, getStrategyConfigForSymbol, validateConfig } from "./config.js";
import { startHealthServer } from "./health.js";
import { createLogger, ErrorThrottler, withRetry } from "./reliability.js";
import { analyzeSymbol } from "./strategy.js";
import {
  addPaperTrade,
  getPairState,
  getPaperAccountState,
  getPerformanceState,
  getRuntimeState,
  recordMarketSnapshot,
  recordSignalDecision,
  updatePairState,
  updatePaperTradeOutcomes,
  updateTradeOutcomes
} from "./state.js";
import { createStateStore } from "./storage.js";
import {
  buildErrorMessage,
  buildHeartbeatMessage,
  buildMonthlyPerformanceMessage,
  buildPaperPerformanceMessage,
  buildSignalMessage,
  buildStartupMessage,
  buildTradeEventMessage,
  buildWeeklyPerformanceMessage,
  sendTelegramMessage
} from "./telegram.js";
import { formatDateTime, formatNumber, formatPrice, sleep, timeframeToMs } from "./utils.js";

let isShuttingDown = false;
let stateStore = null;
let healthServer = null;
const logger = createLogger(config.runtime.logLevel);

const oneDayMs = 24 * 60 * 60 * 1000;

const weekdayNumbers = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
};

function getZonedDateParts(timestamp, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value])
  );

  return {
    weekday: weekdayNumbers[parts.weekday],
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: Number(parts.hour)
  };
}

function getWeeklyReportKey(timestamp, reportConfig) {
  const parts = getZonedDateParts(timestamp, reportConfig.reportTimezone);
  if (parts.weekday !== reportConfig.reportDay || parts.hour < reportConfig.reportHour) return null;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getMonthlyReportKey(timestamp, reportConfig) {
  const parts = getZonedDateParts(timestamp, reportConfig.reportTimezone);
  if (Number(parts.day) !== reportConfig.monthlyReportDay || parts.hour < reportConfig.monthlyReportHour) return null;
  return `${parts.year}-${parts.month}`;
}

function buildPerformanceReport(state, periodMs, now = Date.now()) {
  const performance = getPerformanceState(state);
  const from = now - periodMs;
  const closedTrades = performance.closedTrades.filter((trade) => trade.closedAt >= from && trade.closedAt <= now);
  const wins = closedTrades.filter((trade) => trade.outcome === "TP2" || trade.outcome === "TP3" || trade.tp2Hit).length;
  const tp3Hits = closedTrades.filter((trade) => trade.outcome === "TP3" || trade.tp3Hit).length;
  const losses = closedTrades.filter((trade) => trade.outcome === "SL").length;
  const pnlSum = closedTrades.reduce((sum, trade) => sum + (Number(trade.pnlPercent) || 0), 0);
  const rSum = closedTrades.reduce((sum, trade) => sum + (Number(trade.realizedR) || 0), 0);
  const targetHits = closedTrades.filter((trade) => trade.tp1Hit || trade.tp2Hit || trade.tp3Hit).length;
  const allClosed = performance.closedTrades.length;
  const allWins = performance.closedTrades.filter((trade) => trade.outcome === "TP2" || trade.outcome === "TP3" || trade.tp2Hit).length;

  return {
    from,
    to: now,
    closed: closedTrades.length,
    wins,
    losses,
    tp3Hits,
    winrate: closedTrades.length > 0 ? wins / closedTrades.length * 100 : 0,
    avgPnlPercent: closedTrades.length > 0 ? pnlSum / closedTrades.length : 0,
    avgR: closedTrades.length > 0 ? rSum / closedTrades.length : 0,
    tpHitRate: closedTrades.length > 0 ? targetHits / closedTrades.length * 100 : 0,
    open: performance.openTrades.length,
    allClosed,
    allWinrate: allClosed > 0 ? allWins / allClosed * 100 : 0
  };
}

function buildPaperReport(state, periodMs, now = Date.now()) {
  const from = now - periodMs;
  const performance = getPerformanceState(state);
  const account = getPaperAccountState(state, config.paper);
  const paperTrades = performance.paperTrades.filter((trade) => trade.openedAt >= from && trade.openedAt <= now);
  const closed = paperTrades.filter((trade) => trade.outcome);
  const wins = closed.filter((trade) => trade.outcome === "TP3" || trade.tp2Hit).length;
  const losses = closed.filter((trade) => trade.outcome === "SL").length;
  const liquidations = closed.filter((trade) => trade.outcome === "LIQUIDATED").length;
  const rSum = closed.reduce((sum, trade) => sum + (Number(trade.realizedR) || 0), 0);

  return {
    from,
    to: now,
    total: paperTrades.length,
    closed: closed.length,
    open: paperTrades.length - closed.length,
    wins,
    losses,
    liquidations,
    winrate: closed.length > 0 ? wins / closed.length * 100 : 0,
    avgR: closed.length > 0 ? rSum / closed.length : 0,
    balance: account.balance,
    usedMargin: account.usedMargin,
    availableBalance: (Number(account.balance) || 0) - (Number(account.usedMargin) || 0),
    realizedPnl: account.realizedPnl,
    totalFees: account.totalFees
  };
}

function createExchange() {
  const ExchangeClass = ccxt[config.exchange.id];

  if (!ExchangeClass) {
    throw new Error(`Exchange '${config.exchange.id}' tidak ditemukan di CCXT.`);
  }

  return new ExchangeClass({
    enableRateLimit: true,
    options: {
      defaultType: config.exchange.marketType
    }
  });
}

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

async function fetchClosedCandles(exchange, symbol, timeframe = config.exchange.timeframe) {
  const rawCandles = await withRetry(
    () => exchange.fetchOHLCV(
      symbol,
      timeframe,
      undefined,
      config.exchange.candleLimit
    ),
    {
      retries: config.runtime.retryAttempts,
      delayMs: config.runtime.retryDelayMs,
      label: `fetchOHLCV ${symbol}`
    }
  );

  const tfMs = timeframeToMs(timeframe);
  const now = Date.now();

  return rawCandles
    .filter((item) => item[0] + tfMs <= now - 1000)
    .map(toCandle);
}

function getHigherTimeframeTrend(candles, strategyConfig) {
  if (!candles.length) return "NEUTRAL";
  const last = candles[candles.length - 1];
  const closes = candles.map((candle) => candle.close);
  const required = strategyConfig.emaLong;
  if (closes.length < required) return "NEUTRAL";
  const recent = closes.slice(-required);
  const emaLong = recent.reduce((sum, close) => sum + close, 0) / recent.length;
  if (last.close > emaLong) return "BULLISH";
  if (last.close < emaLong) return "BEARISH";
  return "NEUTRAL";
}

function signalPassesHigherTimeframe(signal, trend) {
  if (!signal || trend === "NEUTRAL") return false;
  return (signal.direction === "BUY" && trend === "BULLISH") || (signal.direction === "SELL" && trend === "BEARISH");
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

async function getFundingRateFilter(exchange, symbol, strategyConfig, signal = null) {
  const enabled = strategyConfig.maxAbsFundingRate > 0 ||
    strategyConfig.maxPositiveFundingLong > 0 ||
    strategyConfig.maxNegativeFundingShort > 0;
  if (!enabled) return { passes: true };
  if (typeof exchange.fetchFundingRate !== "function") {
    return { passes: false, reason: "funding_rate_unsupported" };
  }

  const funding = await withRetry(() => exchange.fetchFundingRate(symbol), {
    retries: config.runtime.retryAttempts,
    delayMs: config.runtime.retryDelayMs,
    label: `fetchFundingRate ${symbol}`
  });
  const fundingRate = firstFiniteNumber(funding?.fundingRate, funding?.info?.fundingRate);

  if (fundingRate === null) return { passes: false, reason: "funding_rate_unavailable" };

  if (strategyConfig.maxAbsFundingRate > 0 && Math.abs(fundingRate) > strategyConfig.maxAbsFundingRate) {
    return { passes: false, reason: "funding_rate_limit", metrics: { fundingRate } };
  }
  if (signal?.direction === "BUY" && strategyConfig.maxPositiveFundingLong > 0 && fundingRate > strategyConfig.maxPositiveFundingLong) {
    return { passes: false, reason: "positive_funding_long_crowded", metrics: { fundingRate } };
  }
  if (signal?.direction === "SELL" && strategyConfig.maxNegativeFundingShort > 0 && fundingRate < -strategyConfig.maxNegativeFundingShort) {
    return { passes: false, reason: "negative_funding_short_crowded", metrics: { fundingRate } };
  }

  return { passes: true, metrics: { fundingRate } };
}

async function getOpenInterestFilter(exchange, symbol, strategyConfig) {
  const enabled = strategyConfig.minOpenInterest > 0 || strategyConfig.maxOpenInterest > 0;
  if (!enabled) return { passes: true };
  if (typeof exchange.fetchOpenInterest !== "function") {
    return { passes: false, reason: "open_interest_unsupported" };
  }

  const openInterestData = await withRetry(() => exchange.fetchOpenInterest(symbol), {
    retries: config.runtime.retryAttempts,
    delayMs: config.runtime.retryDelayMs,
    label: `fetchOpenInterest ${symbol}`
  });
  const openInterest = firstFiniteNumber(
    openInterestData?.openInterestAmount,
    openInterestData?.openInterestValue,
    openInterestData?.baseVolume,
    openInterestData?.quoteVolume,
    openInterestData?.info?.openInterest
  );

  if (openInterest === null) return { passes: false, reason: "open_interest_unavailable" };
  if (strategyConfig.minOpenInterest > 0 && openInterest < strategyConfig.minOpenInterest) {
    return { passes: false, reason: "open_interest_below_min", metrics: { openInterest } };
  }
  if (strategyConfig.maxOpenInterest > 0 && openInterest > strategyConfig.maxOpenInterest) {
    return { passes: false, reason: "open_interest_above_max", metrics: { openInterest } };
  }

  return { passes: true, metrics: { openInterest } };
}

async function getLongShortRatioFilter(exchange, symbol, strategyConfig) {
  const enabled = strategyConfig.minLongShortRatio > 0 || strategyConfig.maxLongShortRatio > 0;
  if (!enabled) return { passes: true };

  let ratioData = null;
  if (typeof exchange.fetchLongShortRatio === "function") {
    ratioData = await withRetry(() => exchange.fetchLongShortRatio(symbol), {
      retries: config.runtime.retryAttempts,
      delayMs: config.runtime.retryDelayMs,
      label: `fetchLongShortRatio ${symbol}`
    });
  } else if (typeof exchange.fetchLongShortRatioHistory === "function") {
    const history = await withRetry(() => exchange.fetchLongShortRatioHistory(symbol, undefined, undefined, 1), {
      retries: config.runtime.retryAttempts,
      delayMs: config.runtime.retryDelayMs,
      label: `fetchLongShortRatioHistory ${symbol}`
    });
    ratioData = Array.isArray(history) ? history.at(-1) : null;
  } else {
    return { passes: false, reason: "long_short_ratio_unsupported" };
  }

  const longShortRatio = firstFiniteNumber(
    ratioData?.longShortRatio,
    ratioData?.ratio,
    ratioData?.info?.longShortRatio,
    ratioData?.info?.longShortRatioValue
  );

  if (longShortRatio === null) return { passes: false, reason: "long_short_ratio_unavailable" };
  if (strategyConfig.minLongShortRatio > 0 && longShortRatio < strategyConfig.minLongShortRatio) {
    return { passes: false, reason: "long_short_ratio_below_min", metrics: { longShortRatio } };
  }
  if (strategyConfig.maxLongShortRatio > 0 && longShortRatio > strategyConfig.maxLongShortRatio) {
    return { passes: false, reason: "long_short_ratio_above_max", metrics: { longShortRatio } };
  }

  return { passes: true, metrics: { longShortRatio } };
}

async function signalPassesMarketDataFilters(exchange, symbol, strategyConfig, signal = null) {
  const checks = [
    await getFundingRateFilter(exchange, symbol, strategyConfig, signal),
    await getOpenInterestFilter(exchange, symbol, strategyConfig),
    await getLongShortRatioFilter(exchange, symbol, strategyConfig)
  ];
  const failed = checks.find((check) => !check.passes);

  return {
    passes: !failed,
    reason: failed?.reason || null,
    metrics: checks.reduce((acc, check) => ({ ...acc, ...(check.metrics || {}) }), {})
  };
}

async function notifyTradeEvents(events) {
  for (const event of events) {
    await notify(buildTradeEventMessage(event, config.runtime.priceDecimals));
  }
}

async function notify(text, chatId = config.telegram.chatId, replyMarkup = null) {
  await withRetry(
    () => sendTelegramMessage({
      botToken: config.telegram.botToken,
      chatId,
      text,
      replyMarkup
    }),
    {
      retries: config.runtime.retryAttempts,
      delayMs: config.runtime.retryDelayMs,
      label: "telegram sendMessage"
    }
  );
}

async function scanSymbol({ exchange, state, stateStore, symbol }) {
  const key = `${config.exchange.id}:${symbol}:${config.exchange.timeframe}`;
  const pairState = getPairState(state, key);
  const strategyConfig = getStrategyConfigForSymbol(symbol);
  const runtime = getRuntimeState(state);
  const paperEnabled = runtime.paperEnabledOverride ?? config.paper.enabled;

  const candles = await fetchClosedCandles(exchange, symbol);
  const lastCandle = candles.at(-1);
  if (lastCandle) {
    recordMarketSnapshot(state, {
      exchange: config.exchange.id,
      symbol,
      timeframe: config.exchange.timeframe,
      candleTime: lastCandle.timestamp,
      open: lastCandle.open,
      high: lastCandle.high,
      low: lastCandle.low,
      close: lastCandle.close,
      volume: lastCandle.volume
    });
  }
  const lifecycleOptions = { maxOpenCandles: config.performance.tradeExpiryCandles };
  const outcome = updateTradeOutcomes(state, key, candles, lifecycleOptions);
  const paperOutcome = paperEnabled
    ? updatePaperTradeOutcomes(state, key, candles, { ...lifecycleOptions, paperConfig: config.paper })
    : { changed: false, events: [] };

  if (outcome.events.length > 0) await notifyTradeEvents(outcome.events);
  if (paperOutcome.events.length > 0) await notifyTradeEvents(paperOutcome.events);

  if (outcome.changed || paperOutcome.changed) {
    await stateStore.save(state);
  }

  const analysis = analyzeSymbol({
    exchangeId: config.exchange.id,
    symbol,
    timeframe: config.exchange.timeframe,
    candles,
    strategyConfig,
    pairState
  });

  if (analysis.hasSignal && strategyConfig.requireHigherTimeframeTrend && strategyConfig.higherTimeframe) {
    const higherCandles = await fetchClosedCandles(exchange, symbol, strategyConfig.higherTimeframe);
    const higherTrend = getHigherTimeframeTrend(higherCandles, strategyConfig);
    analysis.signal.higherTimeframe = strategyConfig.higherTimeframe;
    analysis.signal.higherTimeframeTrend = higherTrend;
    if (!signalPassesHigherTimeframe(analysis.signal, higherTrend)) {
      analysis.hasSignal = false;
      analysis.debug = { ...analysis.debug, rejectedByHigherTimeframe: true, higherTimeframeTrend: higherTrend };
    }
  }

  if (analysis.hasSignal) {
    const marketDataFilter = await signalPassesMarketDataFilters(exchange, symbol, strategyConfig, analysis.signal);
    analysis.signal.marketDataFilters = marketDataFilter.metrics;
    if (!marketDataFilter.passes) {
      analysis.hasSignal = false;
      analysis.debug = {
        ...analysis.debug,
        rejectedByMarketDataFilter: true,
        marketDataFilterReason: marketDataFilter.reason,
        marketDataFilters: marketDataFilter.metrics
      };
    }
  }

  if (analysis.hasSignal) {
    analysis.signal.configHash = getConfigHash({ exchange: config.exchange, strategy: strategyConfig, paper: config.paper });
    const message = buildSignalMessage(analysis.signal, config.runtime.priceDecimals);

    await notify(message);

    updatePairState(state, key, analysis.signal);
    let paperRejectReason = null;
    if (paperEnabled) {
      const paperResult = addPaperTrade(state, key, analysis.signal, config.paper);
      if (!paperResult.added) {
        paperRejectReason = paperResult.reason;
        logger.warn("paper trade skipped", { symbol, reason: paperResult.reason });
      }
    }
    recordSignalDecision(state, {
      exchange: config.exchange.id,
      symbol,
      timeframe: config.exchange.timeframe,
      accepted: true,
      reason: null,
      paperRejectReason,
      direction: analysis.signal.direction,
      entryMode: analysis.signal.entryMode,
      score: analysis.signal.score,
      rr: analysis.signal.rr,
      slRiskPercent: analysis.signal.slRiskPercent,
      strategyVersion: strategyConfig.version,
      configHash: getConfigHash({ exchange: config.exchange, strategy: strategyConfig, paper: config.paper }),
      debug: analysis.debug
    });
    await stateStore.save(state);

    logger.info("signal", {
      direction: analysis.signal.direction,
      symbol,
      timeframe: config.exchange.timeframe,
      entry: analysis.signal.entry,
      rr: analysis.signal.rr
    });

    return;
  }

  const debug = analysis.debug;
  recordSignalDecision(state, {
    exchange: config.exchange.id,
    symbol,
    timeframe: config.exchange.timeframe,
    accepted: false,
    reason: analysis.reason || getRejectedReason(debug),
    strategyVersion: strategyConfig.version,
    configHash: getConfigHash({ exchange: config.exchange, strategy: strategyConfig, paper: config.paper }),
    debug
  });
  await stateStore.save(state);
  if (debug) {
    logger.info("scan", {
      symbol,
      timeframe: config.exchange.timeframe,
      close: formatPrice(debug.close, config.runtime.priceDecimals),
      buyScore: debug.buyScore,
      sellScore: debug.sellScore,
      buyRR: formatNumber(debug.buyRR, 2),
      sellRR: formatNumber(debug.sellRR, 2),
      trend: debug.trend,
      candle: formatDateTime(debug.lastCandleTime),
      rejectedByHigherTimeframe: Boolean(debug.rejectedByHigherTimeframe),
      higherTimeframeTrend: debug.higherTimeframeTrend,
      rejectedByMarketDataFilter: Boolean(debug.rejectedByMarketDataFilter),
      marketDataFilterReason: debug.marketDataFilterReason,
      marketRegime: debug.marketRegime?.labels?.join(",")
    });
  } else {
    logger.info("scan skipped", { symbol, reason: analysis.reason });
  }
}

function getRejectedReason(debug) {
  if (!debug) return "no_debug";
  if (debug.inCooldown) return "cooldown";
  if (debug.rejectedByHigherTimeframe) return "higher_timeframe";
  if (debug.rejectedByMarketDataFilter) return debug.marketDataFilterReason || "market_data_filter";
  if (!debug.marketRegimeAllowed) return "market_regime";
  if (debug.buyQuality?.rejectionReasons?.length || debug.sellQuality?.rejectionReasons?.length) {
    return [...(debug.buyQuality?.rejectionReasons || []), ...(debug.sellQuality?.rejectionReasons || [])].join(",");
  }
  return "strategy_conditions";
}

async function sendHeartbeatIfDue(state, stateStore) {
  if (!config.runtime.heartbeatEnabled) return;
  const runtime = getRuntimeState(state);
  const intervalMs = config.runtime.heartbeatIntervalHours * 60 * 60 * 1000;
  const now = Date.now();
  if (runtime.lastHeartbeatAt && now - runtime.lastHeartbeatAt < intervalMs) return;

  await notify(buildHeartbeatMessage({ runtime, openTrades: getPerformanceState(state).openTrades.length }));
  runtime.lastHeartbeatAt = now;
  await stateStore.save(state);
}

async function sendWeeklyPerformanceReportIfDue(state, stateStore) {
  if (!config.performance.weeklyReportEnabled) return;

  const now = Date.now();
  const reportKey = getWeeklyReportKey(now, config.performance);
  if (!reportKey) return;

  const performance = getPerformanceState(state);
  if (performance.lastWeeklyReportKey === reportKey) return;

  const report = buildPerformanceReport(state, 7 * oneDayMs, now);
  await notify(buildWeeklyPerformanceMessage(report));

  performance.lastWeeklyReportKey = reportKey;
  await stateStore.save(state);
}

async function sendMonthlyPerformanceReportIfDue(state, stateStore) {
  if (!config.performance.monthlyReportEnabled) return;

  const now = Date.now();
  const reportKey = getMonthlyReportKey(now, config.performance);
  if (!reportKey) return;

  const performance = getPerformanceState(state);
  if (performance.lastMonthlyReportKey === reportKey) return;

  const report = buildPerformanceReport(state, 30 * oneDayMs, now);
  await notify(buildMonthlyPerformanceMessage(report));

  performance.lastMonthlyReportKey = reportKey;
  await stateStore.save(state);
}

async function sendPaperPerformanceReportIfDue(state, stateStore) {
  const runtime = getRuntimeState(state);
  if (!(runtime.paperEnabledOverride ?? config.paper.enabled)) return;

  const now = Date.now();
  const reportKey = getWeeklyReportKey(now, config.performance);
  if (!reportKey) return;

  const performance = getPerformanceState(state);
  if (performance.lastPaperReportKey === reportKey) return;

  await notify(buildPaperPerformanceMessage(buildPaperReport(state, 7 * oneDayMs, now)));
  performance.lastPaperReportKey = reportKey;
  await stateStore.save(state);
}

async function scanAll({ exchange, state, stateStore, errorThrottler }) {
  const runtime = getRuntimeState(state);
  runtime.lastScanAt = Date.now();

  for (const symbol of config.exchange.symbols) {
    if (runtime.pausedSymbols?.[symbol]) {
      logger.info("symbol paused", { symbol });
      continue;
    }
    try {
      await scanSymbol({ exchange, state, stateStore, symbol });
    } catch (error) {
      console.error(`[ERROR] ${symbol}:`, error.message);
      runtime.lastScanErrorAt = Date.now();
      runtime.lastScanError = `${symbol}: ${error.message}`;

      if (config.telegram.alertErrors && errorThrottler.shouldSend(`scan:${symbol}:${error.message}`)) {
        await notify(buildErrorMessage(error, `scan ${symbol}`));
      }
    }
  }

  try {
    await sendWeeklyPerformanceReportIfDue(state, stateStore);
  } catch (error) {
    console.error("[ERROR] weekly performance report:", error.message);
  }

  try {
    await sendMonthlyPerformanceReportIfDue(state, stateStore);
  } catch (error) {
    console.error("[ERROR] monthly performance report:", error.message);
  }

  try {
    await sendPaperPerformanceReportIfDue(state, stateStore);
  } catch (error) {
    logger.error("paper performance report failed", { error: error.message });
  }

  try {
    await sendHeartbeatIfDue(state, stateStore);
  } catch (error) {
    logger.error("heartbeat failed", { error: error.message });
  }

  runtime.lastScanSuccessAt = Date.now();
  await stateStore.save(state);
}

async function main() {
  validateConfig();

  const exchange = createExchange();

  logger.info("loading markets", { exchange: config.exchange.id });
  await withRetry(
    () => exchange.loadMarkets(),
    {
      retries: config.runtime.retryAttempts,
      delayMs: config.runtime.retryDelayMs,
      label: `loadMarkets ${config.exchange.id}`
    }
  );

  for (const symbol of config.exchange.symbols) {
    if (!exchange.markets[symbol]) {
      logger.warn("symbol not found in loaded markets", { symbol, exchange: config.exchange.id });
    }
  }

  stateStore = createStateStore(config.runtime);
  if (config.runtime.singleInstanceLockEnabled) {
    await stateStore.acquireLock(config.runtime.lockFile);
  }
  const state = await stateStore.load();
  runStartupSelfCheck({ exchange, state });
  const appStatus = { scanRequested: false };
  const errorThrottler = new ErrorThrottler(config.runtime.errorAlertCooldownSeconds * 1000);
  healthServer = startHealthServer({ config, state, getStatus: () => (isShuttingDown ? "shutting_down" : "running") });

  logger.info("bot started", {
    exchange: config.exchange.id,
    symbols: config.exchange.symbols,
    timeframe: config.exchange.timeframe,
    intervalSeconds: config.exchange.checkIntervalSeconds,
    storage: stateStore.type
  });

  const commandLoop = runCommandLoop({
    state,
    stateStore,
    config,
    appStatus,
    notify,
    isShuttingDown: () => isShuttingDown
  });

  if (config.telegram.sendStartupMessage) {
    await notify(buildStartupMessage({
      exchangeId: config.exchange.id,
      symbols: config.exchange.symbols,
      timeframe: config.exchange.timeframe,
      checkIntervalSeconds: config.exchange.checkIntervalSeconds
    }));
  }

  while (!isShuttingDown) {
    const runtime = getRuntimeState(state);

    if (runtime.paused && !appStatus.scanRequested) {
      logger.info("scanner paused");
    } else {
      appStatus.scanRequested = false;
      await scanAll({ exchange, state, stateStore, errorThrottler });
    }

    if (config.exchange.runOnce) {
      logger.info("run once complete");
      isShuttingDown = true;
      break;
    }

    await sleep(config.exchange.checkIntervalSeconds * 1000);
  }

  await commandLoop;
  if (healthServer) healthServer.close();
  await stateStore.close();
}

function runStartupSelfCheck({ exchange, state }) {
  const runtime = getRuntimeState(state);
  const missingSymbols = config.exchange.symbols.filter((symbol) => !exchange.markets[symbol]);
  if (missingSymbols.length > 0) {
    logger.warn("startup self-check missing symbols", { missingSymbols });
  }
  logger.info("startup self-check", {
    stateSchemaVersion: state.schemaVersion,
    storage: stateStore?.type,
    telegramConfigured: Boolean(config.telegram.botToken && config.telegram.chatId),
    paused: runtime.paused
  });
}

process.on("SIGINT", () => {
  logger.info("SIGINT received");
  isShuttingDown = true;
});

process.on("SIGTERM", () => {
  logger.info("SIGTERM received");
  isShuttingDown = true;
});

main().catch(async (error) => {
  logger.error("fatal", { error: error.message, stack: error.stack });

  try {
    if (config.telegram.botToken && config.telegram.chatId) {
      await notify(buildErrorMessage(error, "fatal startup"));
    }
  } catch (telegramError) {
    console.error("[FATAL] Gagal mengirim error ke Telegram:", telegramError.message);
  }

  try {
    if (stateStore) await stateStore.close();
    if (healthServer) healthServer.close();
  } catch (closeError) {
    console.error("[FATAL] Gagal menutup state store:", closeError.message);
  }

  process.exit(1);
});
