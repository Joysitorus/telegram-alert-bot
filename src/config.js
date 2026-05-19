import "dotenv/config";
import { parseCsv, toBoolean, toNumber } from "./utils.js";

export const config = {
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || "",
    chatId: process.env.TELEGRAM_CHAT_ID || "",
    sendStartupMessage: toBoolean(process.env.SEND_STARTUP_MESSAGE, true),
    alertErrors: toBoolean(process.env.ALERT_ERRORS, false)
  },

  exchange: {
    id: process.env.EXCHANGE || "bitget",
    marketType: process.env.MARKET_TYPE || "swap",
    symbols: parseCsv(process.env.SYMBOLS || process.env.SYMBOL, ["PEPE/USDT:USDT"]),
    timeframe: process.env.TIMEFRAME || "15m",
    candleLimit: toNumber(process.env.CANDLE_LIMIT, 1000, { min: 250, max: 1000 }),
    checkIntervalSeconds: toNumber(process.env.CHECK_INTERVAL_SECONDS, 60, { min: 10, max: 3600 }),
    runOnce: toBoolean(process.env.RUN_ONCE, false)
  },

  runtime: {
    stateFile: process.env.STATE_FILE || "./state.json",
    priceDecimals: toNumber(process.env.PRICE_DECIMALS, 12, { min: 2, max: 18 }),
    logLevel: process.env.LOG_LEVEL || "info"
  },

  strategy: {
    emaFast: toNumber(process.env.EMA_FAST, 20, { min: 1, max: 500 }),
    emaMid: toNumber(process.env.EMA_MID, 50, { min: 1, max: 500 }),
    emaLong: toNumber(process.env.EMA_LONG, 200, { min: 1, max: 1000 }),

    rsiLength: toNumber(process.env.RSI_LENGTH, 14, { min: 2, max: 100 }),
    volumeMaLength: toNumber(process.env.VOLUME_MA_LENGTH, 20, { min: 2, max: 200 }),

    atrLength: toNumber(process.env.ATR_LENGTH, 14, { min: 2, max: 100 }),
    adxLength: toNumber(process.env.ADX_LENGTH, 14, { min: 2, max: 100 }),
    adxSmoothing: toNumber(process.env.ADX_SMOOTHING, 14, { min: 2, max: 100 }),

    breakoutLength: toNumber(process.env.BREAKOUT_LENGTH, 20, { min: 2, max: 500 }),
    minConfirm: toNumber(process.env.MIN_CONFIRM, 5, { min: 3, max: 7 }),

    safeSlLookback: toNumber(process.env.SAFE_SL_LOOKBACK, 20, { min: 2, max: 500 }),
    safeSlBufferATR: toNumber(process.env.SAFE_SL_BUFFER_ATR, 0.35, { min: 0, max: 10 }),
    maxSafeSlPercent: toNumber(process.env.MAX_SAFE_SL_PERCENT, 5.0, { min: 0.1, max: 50 }),
    minRR: toNumber(process.env.MIN_RR, 3.0, { min: 0.5, max: 50 }),

    pivotLeft: toNumber(process.env.PIVOT_LEFT, 3, { min: 1, max: 50 }),
    pivotRight: toNumber(process.env.PIVOT_RIGHT, 3, { min: 1, max: 50 }),

    liquidityTouchLookback: toNumber(process.env.LIQUIDITY_TOUCH_LOOKBACK, 150, { min: 30, max: 1000 }),
    maxLiquidityCandidates: toNumber(process.env.MAX_LIQUIDITY_CANDIDATES, 40, { min: 10, max: 200 }),
    liquidityToleranceATR: toNumber(process.env.LIQUIDITY_TOLERANCE_ATR, 0.35, { min: 0.01, max: 5 }),
    minLiquidityTouches: toNumber(process.env.MIN_LIQUIDITY_TOUCHES, 2, { min: 1, max: 50 }),
    maxTargetATRDistance: toNumber(process.env.MAX_TARGET_ATR_DISTANCE, 20.0, { min: 1, max: 500 }),

    requireOrderBlock: toBoolean(process.env.REQUIRE_ORDER_BLOCK, true),
    orderBlockLookback: toNumber(process.env.ORDER_BLOCK_LOOKBACK, 120, { min: 20, max: 1000 }),
    orderBlockImpulseLookahead: toNumber(process.env.ORDER_BLOCK_IMPULSE_LOOKAHEAD, 6, { min: 1, max: 50 }),
    orderBlockMinDisplacementATR: toNumber(process.env.ORDER_BLOCK_MIN_DISPLACEMENT_ATR, 1.2, { min: 0.1, max: 20 }),
    orderBlockMaxZoneATR: toNumber(process.env.ORDER_BLOCK_MAX_ZONE_ATR, 2.0, { min: 0.1, max: 20 }),
    orderBlockMaxEntryDistanceATR: toNumber(process.env.ORDER_BLOCK_MAX_ENTRY_DISTANCE_ATR, 1.5, { min: 0, max: 20 }),
    minOrderBlockScore: toNumber(process.env.MIN_ORDER_BLOCK_SCORE, 60, { min: 0, max: 200 }),

    tp1Portion: toNumber(process.env.TP1_PORTION, 0.33, { min: 0.05, max: 0.95 }),
    tp2Portion: toNumber(process.env.TP2_PORTION, 0.66, { min: 0.05, max: 0.99 })
  }
};

export function validateConfig() {
  const errors = [];

  if (!config.telegram.botToken) errors.push("TELEGRAM_BOT_TOKEN belum diisi.");
  if (!config.telegram.chatId) errors.push("TELEGRAM_CHAT_ID belum diisi.");
  if (!config.exchange.id) errors.push("EXCHANGE belum diisi.");
  if (!config.exchange.symbols.length) errors.push("SYMBOLS belum diisi.");

  if (config.strategy.emaFast >= config.strategy.emaMid) {
    errors.push("EMA_FAST sebaiknya lebih kecil dari EMA_MID.");
  }

  if (config.strategy.emaMid >= config.strategy.emaLong) {
    errors.push("EMA_MID sebaiknya lebih kecil dari EMA_LONG.");
  }

  if (config.strategy.tp1Portion >= config.strategy.tp2Portion) {
    errors.push("TP1_PORTION harus lebih kecil dari TP2_PORTION.");
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
}
