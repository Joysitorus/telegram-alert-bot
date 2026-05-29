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

export function summarizeReplay(state) {
  const performance = getPerformanceState(state);
  const paperTrades = performance.paperTrades;
  const paperAccount = performance.paperAccount || {};
  const bySymbol = {};

  for (const trade of paperTrades) {
    const symbol = trade.symbol || "unknown";
    if (!bySymbol[symbol]) bySymbol[symbol] = [];
    bySymbol[symbol].push(trade);
  }

  return {
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

  for (const symbol of config.exchange.symbols) {
    const key = `${config.exchange.id}:${symbol}:${config.exchange.timeframe}`;
    const strategyConfig = getStrategyConfigForSymbol(symbol);
    const candles = useDatabase
      ? await loadReplayCandlesFromDatabase(stateStore, exchange, symbol)
      : await fetchReplayCandles(exchange, symbol);

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

  console.log(JSON.stringify(summarizeReplay(state), null, 2));
  if (stateStore) await stateStore.close();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
