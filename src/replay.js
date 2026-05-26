import ccxt from "ccxt";
import { config, getStrategyConfigForSymbol } from "./config.js";
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

function summarize(state) {
  const paperTrades = getPerformanceState(state).paperTrades;
  const closed = paperTrades.filter((trade) => trade.outcome);
  const wins = closed.filter((trade) => trade.outcome === "TP3" || trade.tp2Hit).length;
  const losses = closed.filter((trade) => trade.outcome === "SL").length;
  const liquidations = closed.filter((trade) => trade.outcome === "LIQUIDATED").length;
  const rSum = closed.reduce((sum, trade) => sum + (Number(trade.realizedR) || 0), 0);
  const pnlSum = closed.reduce((sum, trade) => sum + (Number(trade.realizedPnlUsdt) || 0), 0);

  return {
    totalTrades: paperTrades.length,
    closedTrades: closed.length,
    openTrades: paperTrades.length - closed.length,
    wins,
    losses,
    liquidations,
    winrate: closed.length ? wins / closed.length * 100 : 0,
    averageR: closed.length ? rSum / closed.length : 0,
    realizedPnlUsdt: pnlSum
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
  const lifecycleOptions = {
    maxOpenCandles: config.performance.tradeExpiryCandles,
    paperConfig: config.paper
  };

  for (const symbol of config.exchange.symbols) {
    const key = `${config.exchange.id}:${symbol}:${config.exchange.timeframe}`;
    const strategyConfig = getStrategyConfigForSymbol(symbol);
    const candles = await fetchReplayCandles(exchange, symbol);

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

  console.log(JSON.stringify(summarize(state), null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
