import ccxt from "ccxt";
import { config, validateConfig } from "./config.js";
import { analyzeSymbol } from "./strategy.js";
import { getPairState, loadState, saveState, updatePairState } from "./state.js";
import {
  buildErrorMessage,
  buildSignalMessage,
  buildStartupMessage,
  sendTelegramMessage
} from "./telegram.js";
import { formatDateTime, formatNumber, formatPrice, sleep, timeframeToMs } from "./utils.js";

let isShuttingDown = false;

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

async function fetchClosedCandles(exchange, symbol) {
  const rawCandles = await exchange.fetchOHLCV(
    symbol,
    config.exchange.timeframe,
    undefined,
    config.exchange.candleLimit
  );

  const tfMs = timeframeToMs(config.exchange.timeframe);
  const now = Date.now();

  return rawCandles
    .filter((item) => item[0] + tfMs <= now - 1000)
    .map(toCandle);
}

async function notify(text) {
  await sendTelegramMessage({
    botToken: config.telegram.botToken,
    chatId: config.telegram.chatId,
    text
  });
}

async function scanSymbol({ exchange, state, symbol }) {
  const key = `${config.exchange.id}:${symbol}:${config.exchange.timeframe}`;
  const pairState = getPairState(state, key);

  const candles = await fetchClosedCandles(exchange, symbol);

  const analysis = analyzeSymbol({
    exchangeId: config.exchange.id,
    symbol,
    timeframe: config.exchange.timeframe,
    candles,
    strategyConfig: config.strategy,
    pairState
  });

  if (analysis.hasSignal) {
    const message = buildSignalMessage(analysis.signal, config.runtime.priceDecimals);

    await notify(message);

    updatePairState(state, key, analysis.signal);
    saveState(config.runtime.stateFile, state);

    console.log(
      `[SIGNAL] ${analysis.signal.direction} ${symbol} ${config.exchange.timeframe} ` +
      `entry=${formatPrice(analysis.signal.entry, config.runtime.priceDecimals)} ` +
      `rr=${formatNumber(analysis.signal.rr, 2)}R`
    );

    return;
  }

  const debug = analysis.debug;
  if (debug) {
    console.log(
      `[SCAN] ${symbol} ${config.exchange.timeframe} ` +
      `close=${formatPrice(debug.close, config.runtime.priceDecimals)} ` +
      `buyScore=${debug.buyScore}/7 sellScore=${debug.sellScore}/7 ` +
      `buyRR=${formatNumber(debug.buyRR, 2)}R sellRR=${formatNumber(debug.sellRR, 2)}R ` +
      `trend=${debug.trend} candle=${formatDateTime(debug.lastCandleTime)}`
    );
  } else {
    console.log(`[SCAN] ${symbol}: ${analysis.reason}`);
  }
}

async function scanAll({ exchange, state }) {
  for (const symbol of config.exchange.symbols) {
    try {
      await scanSymbol({ exchange, state, symbol });
    } catch (error) {
      console.error(`[ERROR] ${symbol}:`, error.message);

      if (config.telegram.alertErrors) {
        await notify(buildErrorMessage(error, `scan ${symbol}`));
      }
    }
  }
}

async function main() {
  validateConfig();

  const exchange = createExchange();

  console.log(`[BOOT] Loading markets from ${config.exchange.id}...`);
  await exchange.loadMarkets();

  for (const symbol of config.exchange.symbols) {
    if (!exchange.markets[symbol]) {
      console.warn(`[WARN] Symbol '${symbol}' tidak ditemukan langsung di market ${config.exchange.id}. Bot tetap mencoba fetchOHLCV.`);
    }
  }

  const state = loadState(config.runtime.stateFile);

  console.log(
    `[BOOT] Bot started. exchange=${config.exchange.id}, symbols=${config.exchange.symbols.join(", ")}, ` +
    `timeframe=${config.exchange.timeframe}, interval=${config.exchange.checkIntervalSeconds}s`
  );

  if (config.telegram.sendStartupMessage) {
    await notify(buildStartupMessage({
      exchangeId: config.exchange.id,
      symbols: config.exchange.symbols,
      timeframe: config.exchange.timeframe,
      checkIntervalSeconds: config.exchange.checkIntervalSeconds
    }));
  }

  while (!isShuttingDown) {
    await scanAll({ exchange, state });

    if (config.exchange.runOnce) {
      console.log("[BOOT] RUN_ONCE=true, bot selesai setelah satu kali scan.");
      break;
    }

    await sleep(config.exchange.checkIntervalSeconds * 1000);
  }
}

process.on("SIGINT", () => {
  console.log("[SHUTDOWN] SIGINT diterima, bot akan berhenti...");
  isShuttingDown = true;
});

process.on("SIGTERM", () => {
  console.log("[SHUTDOWN] SIGTERM diterima, bot akan berhenti...");
  isShuttingDown = true;
});

main().catch(async (error) => {
  console.error("[FATAL]", error);

  try {
    if (config.telegram.botToken && config.telegram.chatId) {
      await notify(buildErrorMessage(error, "fatal startup"));
    }
  } catch (telegramError) {
    console.error("[FATAL] Gagal mengirim error ke Telegram:", telegramError.message);
  }

  process.exit(1);
});
