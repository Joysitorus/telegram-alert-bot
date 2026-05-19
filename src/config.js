import "dotenv/config";
import { parseCsv, parseJson, toBoolean, toNumber } from "./utils.js";

const builtInStrategyProfiles = {
  scalping: { minConfirm: 5, minRR: 2.0, maxSafeSlPercent: 3.0, cooldownSeconds: 900 },
  swing: { minConfirm: 5, minRR: 3.0, maxSafeSlPercent: 6.0, cooldownSeconds: 7200 },
  meme: { minConfirm: 6, minRR: 4.0, maxSafeSlPercent: 8.0, cooldownSeconds: 1800 },
  major: { minConfirm: 5, minRR: 2.5, maxSafeSlPercent: 4.0, cooldownSeconds: 3600 }
};

export const config = {
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || "",
    chatId: process.env.TELEGRAM_CHAT_ID || "",
    adminIds: parseCsv(process.env.TELEGRAM_ADMIN_IDS || "", []),
    sendStartupMessage: toBoolean(process.env.SEND_STARTUP_MESSAGE, true),
    alertErrors: toBoolean(process.env.ALERT_ERRORS, false),
    commandsEnabled: toBoolean(process.env.TELEGRAM_COMMANDS_ENABLED, true),
    commandPollTimeoutSeconds: toNumber(process.env.TELEGRAM_COMMAND_POLL_TIMEOUT_SECONDS, 25, { min: 1, max: 50 })
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
    databaseUrl: process.env.DATABASE_URL || "",
    priceDecimals: toNumber(process.env.PRICE_DECIMALS, 12, { min: 2, max: 18 }),
    logLevel: process.env.LOG_LEVEL || "info",
    retryAttempts: toNumber(process.env.RETRY_ATTEMPTS, 3, { min: 1, max: 10 }),
    retryDelayMs: toNumber(process.env.RETRY_DELAY_MS, 1000, { min: 100, max: 60000 }),
    errorAlertCooldownSeconds: toNumber(process.env.ERROR_ALERT_COOLDOWN_SECONDS, 900, { min: 30, max: 86400 }),
    healthcheckEnabled: toBoolean(process.env.HEALTHCHECK_ENABLED, false),
    healthcheckPort: toNumber(process.env.PORT || process.env.HEALTHCHECK_PORT, 3000, { min: 1, max: 65535 }),
    heartbeatEnabled: toBoolean(process.env.HEARTBEAT_ENABLED, false),
    heartbeatIntervalHours: toNumber(process.env.HEARTBEAT_INTERVAL_HOURS, 24, { min: 1, max: 168 })
  },

  paper: {
    enabled: toBoolean(process.env.PAPER_TRADING_ENABLED, false),
    feePercent: toNumber(process.env.PAPER_TRADING_FEE_PERCENT, 0, { min: 0, max: 5 }),
    slippagePercent: toNumber(process.env.PAPER_TRADING_SLIPPAGE_PERCENT, 0, { min: 0, max: 5 })
  },

  performance: {
    weeklyReportEnabled: toBoolean(process.env.WEEKLY_PERFORMANCE_REPORT_ENABLED, true),
    monthlyReportEnabled: toBoolean(process.env.MONTHLY_PERFORMANCE_REPORT_ENABLED, true),
    reportTimezone: process.env.PERFORMANCE_REPORT_TIMEZONE || "Asia/Jakarta",
    reportDay: toNumber(process.env.PERFORMANCE_REPORT_DAY, 1, { min: 0, max: 6 }),
    reportHour: toNumber(process.env.PERFORMANCE_REPORT_HOUR, 8, { min: 0, max: 23 }),
    monthlyReportDay: toNumber(process.env.MONTHLY_PERFORMANCE_REPORT_DAY, 1, { min: 1, max: 28 }),
    monthlyReportHour: toNumber(process.env.MONTHLY_PERFORMANCE_REPORT_HOUR, 8, { min: 0, max: 23 })
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
    tp2Portion: toNumber(process.env.TP2_PORTION, 0.66, { min: 0.05, max: 0.99 }),
    profile: process.env.STRATEGY_PROFILE || "",
    customProfiles: parseJson(process.env.STRATEGY_PROFILES_JSON, {}),
    symbolOverrides: parseJson(process.env.SYMBOL_STRATEGY_OVERRIDES_JSON, {}),
    higherTimeframe: process.env.HIGHER_TIMEFRAME || "",
    requireHigherTimeframeTrend: toBoolean(process.env.REQUIRE_HIGHER_TIMEFRAME_TREND, false),
    cooldownSeconds: toNumber(process.env.SIGNAL_COOLDOWN_SECONDS, 0, { min: 0, max: 86400 })
  }
};

export function getStrategyConfigForSymbol(symbol) {
  const profileOverrides = {
    ...builtInStrategyProfiles,
    ...config.strategy.customProfiles
  }[config.strategy.profile] || {};
  const symbolOverrides = config.strategy.symbolOverrides[symbol] || {};

  return {
    ...config.strategy,
    ...profileOverrides,
    ...symbolOverrides
  };
}

export function validateConfig() {
  const errors = [];

  if (!config.telegram.botToken) errors.push("TELEGRAM_BOT_TOKEN belum diisi.");
  if (!config.telegram.chatId) errors.push("TELEGRAM_CHAT_ID belum diisi.");
  if (!config.exchange.id) errors.push("EXCHANGE belum diisi.");
  if (!config.exchange.symbols.length) errors.push("SYMBOLS belum diisi.");

  if (!/^\d+[mhdwM]$/.test(config.exchange.timeframe)) {
    errors.push("TIMEFRAME tidak valid. Contoh valid: 1m, 15m, 1h, 4h, 1d.");
  }

  if (config.strategy.emaFast >= config.strategy.emaMid) {
    errors.push("EMA_FAST sebaiknya lebih kecil dari EMA_MID.");
  }

  if (config.strategy.emaMid >= config.strategy.emaLong) {
    errors.push("EMA_MID sebaiknya lebih kecil dari EMA_LONG.");
  }

  if (config.strategy.tp1Portion >= config.strategy.tp2Portion) {
    errors.push("TP1_PORTION harus lebih kecil dari TP2_PORTION.");
  }

  if (config.strategy.higherTimeframe && !/^\d+[mhdwM]$/.test(config.strategy.higherTimeframe)) {
    errors.push("HIGHER_TIMEFRAME tidak valid. Contoh valid: 1h, 4h, 1d.");
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
}
