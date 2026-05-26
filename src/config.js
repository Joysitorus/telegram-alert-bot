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
    operatorIds: parseCsv(process.env.TELEGRAM_OPERATOR_IDS || "", []),
    viewerIds: parseCsv(process.env.TELEGRAM_VIEWER_IDS || "", []),
    sendStartupMessage: toBoolean(process.env.SEND_STARTUP_MESSAGE, true),
    alertErrors: toBoolean(process.env.ALERT_ERRORS, false),
    syncCommands: toBoolean(process.env.TELEGRAM_SYNC_COMMANDS, true),
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
    dashboardEnabled: toBoolean(process.env.DASHBOARD_ENABLED, false),
    heartbeatEnabled: toBoolean(process.env.HEARTBEAT_ENABLED, false),
    heartbeatIntervalHours: toNumber(process.env.HEARTBEAT_INTERVAL_HOURS, 24, { min: 1, max: 168 }),
    singleInstanceLockEnabled: toBoolean(process.env.SINGLE_INSTANCE_LOCK_ENABLED, true),
    lockFile: process.env.LOCK_FILE || "./bot.lock",
    dataRetentionDays: toNumber(process.env.DATA_RETENTION_DAYS, 30, { min: 1, max: 3650 })
  },

  paper: {
    enabled: toBoolean(process.env.PAPER_TRADING_ENABLED, false),
    feePercent: toNumber(process.env.PAPER_TRADING_FEE_PERCENT, 0, { min: 0, max: 5 }),
    slippagePercent: toNumber(process.env.PAPER_TRADING_SLIPPAGE_PERCENT, 0, { min: 0, max: 5 }),
    initialBalance: toNumber(process.env.PAPER_TRADING_INITIAL_BALANCE, 100, { min: 0 }),
    positionNotional: toNumber(process.env.PAPER_TRADING_POSITION_NOTIONAL, 500, { min: 0 }),
    leverage: toNumber(process.env.PAPER_TRADING_LEVERAGE, 75, { min: 1, max: 125 }),
    maintenanceMarginPercent: toNumber(process.env.PAPER_TRADING_MAINTENANCE_MARGIN_PERCENT, 0.5, { min: 0, max: 10 }),
    maxOpenTrades: toNumber(process.env.PAPER_TRADING_MAX_OPEN_TRADES, 0, { min: 0, max: 1000 }),
    riskMode: process.env.PAPER_TRADING_RISK_MODE || "fixed_notional",
    fixedMargin: toNumber(process.env.PAPER_TRADING_FIXED_MARGIN, 0, { min: 0 }),
    riskPercentEquity: toNumber(process.env.PAPER_TRADING_RISK_PERCENT_EQUITY, 1, { min: 0, max: 100 }),
    maxLossUsdt: toNumber(process.env.PAPER_TRADING_MAX_LOSS_USDT, 0, { min: 0 }),
    maxLossPercentEquity: toNumber(process.env.PAPER_TRADING_MAX_LOSS_PERCENT_EQUITY, 0, { min: 0, max: 100 }),
    minLiquidationBufferPercent: toNumber(process.env.PAPER_TRADING_MIN_LIQUIDATION_BUFFER_PERCENT, 0, { min: 0, max: 100 }),
    dailyLossLimitUsdt: toNumber(process.env.PAPER_TRADING_DAILY_LOSS_LIMIT_USDT, 0, { min: 0 }),
    maxDrawdownPercent: toNumber(process.env.PAPER_TRADING_MAX_DRAWDOWN_PERCENT, 0, { min: 0, max: 100 }),
    maxOpenNotional: toNumber(process.env.PAPER_TRADING_MAX_OPEN_NOTIONAL, 0, { min: 0 }),
    maxUsedMargin: toNumber(process.env.PAPER_TRADING_MAX_USED_MARGIN, 0, { min: 0 }),
    breakEvenAfterTp1: toBoolean(process.env.PAPER_TRADING_BREAK_EVEN_AFTER_TP1, false),
    trailAfterTp2: toBoolean(process.env.PAPER_TRADING_TRAIL_AFTER_TP2, false)
  },

  performance: {
    weeklyReportEnabled: toBoolean(process.env.WEEKLY_PERFORMANCE_REPORT_ENABLED, true),
    monthlyReportEnabled: toBoolean(process.env.MONTHLY_PERFORMANCE_REPORT_ENABLED, true),
    reportTimezone: process.env.PERFORMANCE_REPORT_TIMEZONE || "Asia/Jakarta",
    reportDay: toNumber(process.env.PERFORMANCE_REPORT_DAY, 1, { min: 0, max: 6 }),
    reportHour: toNumber(process.env.PERFORMANCE_REPORT_HOUR, 8, { min: 0, max: 23 }),
    monthlyReportDay: toNumber(process.env.MONTHLY_PERFORMANCE_REPORT_DAY, 1, { min: 1, max: 28 }),
    monthlyReportHour: toNumber(process.env.MONTHLY_PERFORMANCE_REPORT_HOUR, 8, { min: 0, max: 23 }),
    tradeExpiryCandles: toNumber(process.env.TRADE_EXPIRY_CANDLES, 0, { min: 0, max: 100000 })
  },

  lesson: {
    enabled: toBoolean(process.env.LESSON_ENABLED, true),
    applyFilter: toBoolean(process.env.LESSON_APPLY_FILTER, true),
    minSamples: toNumber(process.env.LESSON_MIN_SAMPLES, 8, { min: 1, max: 1000 }),
    minWinRate: toNumber(process.env.LESSON_MIN_WIN_RATE, 35, { min: 0, max: 100 }),
    minAvgR: toNumber(process.env.LESSON_MIN_AVG_R, 0, { min: -100, max: 100 }),
    maxLosingStreak: toNumber(process.env.LESSON_MAX_LOSING_STREAK, 4, { min: 0, max: 100 }),
    maxRecords: toNumber(process.env.LESSON_MAX_RECORDS, 2000, { min: 100, max: 100000 })
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
    tp1ExitPortion: toNumber(process.env.TP1_EXIT_PORTION, 0.33, { min: 0, max: 1 }),
    tp2ExitPortion: toNumber(process.env.TP2_EXIT_PORTION, 0.33, { min: 0, max: 1 }),
    version: process.env.STRATEGY_VERSION || "breakout_v1",
    entryMode: process.env.ENTRY_MODE || "breakout_close",
    minBreakoutAtr: toNumber(process.env.MIN_BREAKOUT_ATR, 0, { min: 0, max: 20 }),
    maxBreakoutExtensionAtr: toNumber(process.env.MAX_BREAKOUT_EXTENSION_ATR, 0, { min: 0, max: 100 }),
    minCandleBodyPercent: toNumber(process.env.MIN_CANDLE_BODY_PERCENT, 0, { min: 0, max: 100 }),
    maxEntryWickPercent: toNumber(process.env.MAX_ENTRY_WICK_PERCENT, 100, { min: 0, max: 100 }),
    minVolumeRatio: toNumber(process.env.MIN_VOLUME_RATIO, 0, { min: 0, max: 100 }),
    rejectFallbackLiquidityTarget: toBoolean(process.env.REJECT_FALLBACK_LIQUIDITY_TARGET, false),
    ignoreLastDirectionBlock: toBoolean(process.env.IGNORE_LAST_DIRECTION_BLOCK, false),
    profile: process.env.STRATEGY_PROFILE || "",
    customProfiles: parseJson(process.env.STRATEGY_PROFILES_JSON, {}),
    symbolOverrides: parseJson(process.env.SYMBOL_STRATEGY_OVERRIDES_JSON, {}),
    higherTimeframe: process.env.HIGHER_TIMEFRAME || "",
    requireHigherTimeframeTrend: toBoolean(process.env.REQUIRE_HIGHER_TIMEFRAME_TREND, false),
    cooldownSeconds: toNumber(process.env.SIGNAL_COOLDOWN_SECONDS, 0, { min: 0, max: 86400 }),
    marketRegimeFilter: parseCsv(process.env.MARKET_REGIME_FILTER || "", []),
    marketRegimeTrendAdx: toNumber(process.env.MARKET_REGIME_TREND_ADX, 25, { min: 1, max: 100 }),
    marketRegimeHighVolAtrPercent: toNumber(process.env.MARKET_REGIME_HIGH_VOL_ATR_PERCENT, 2, { min: 0.01, max: 100 }),
    maxAbsFundingRate: toNumber(process.env.MAX_ABS_FUNDING_RATE, 0, { min: 0, max: 1 }),
    maxPositiveFundingLong: toNumber(process.env.MAX_POSITIVE_FUNDING_LONG, 0, { min: 0, max: 1 }),
    maxNegativeFundingShort: toNumber(process.env.MAX_NEGATIVE_FUNDING_SHORT, 0, { min: 0, max: 1 }),
    minOpenInterest: toNumber(process.env.MIN_OPEN_INTEREST, 0, { min: 0 }),
    maxOpenInterest: toNumber(process.env.MAX_OPEN_INTEREST, 0, { min: 0 }),
    minLongShortRatio: toNumber(process.env.MIN_LONG_SHORT_RATIO, 0, { min: 0 }),
    maxLongShortRatio: toNumber(process.env.MAX_LONG_SHORT_RATIO, 0, { min: 0 })
  }
};

export function getStrategyConfigForSymbol(symbol) {
  const profileOverrides = {
    ...builtInStrategyProfiles,
    ...config.strategy.customProfiles
  }[config.strategy.profile] || {};
  const symbolOverrides = config.strategy.symbolOverrides[symbol] || {};
  const strategyConfig = {
    ...config.strategy,
    ...profileOverrides,
    ...symbolOverrides
  };

  return {
    ...strategyConfig,
    tp3ExitPortion: Math.max(0, 1 - strategyConfig.tp1ExitPortion - strategyConfig.tp2ExitPortion)
  };
}

export function getConfigHash(value = config) {
  const json = stableStringify(value);
  let hash = 0;
  for (let index = 0; index < json.length; index += 1) {
    hash = ((hash << 5) - hash + json.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(16);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
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

  if (config.strategy.tp1ExitPortion + config.strategy.tp2ExitPortion > 1) {
    errors.push("TP1_EXIT_PORTION + TP2_EXIT_PORTION tidak boleh lebih dari 1.");
  }

  if (config.strategy.higherTimeframe && !/^\d+[mhdwM]$/.test(config.strategy.higherTimeframe)) {
    errors.push("HIGHER_TIMEFRAME tidak valid. Contoh valid: 1h, 4h, 1d.");
  }

  const validRegimes = new Set(["trending", "ranging", "high_volatility", "low_volatility"]);
  for (const regime of config.strategy.marketRegimeFilter) {
    if (!validRegimes.has(regime)) {
      errors.push(`MARKET_REGIME_FILTER tidak valid: ${regime}. Gunakan trending,ranging,high_volatility,low_volatility.`);
    }
  }

  if (config.strategy.maxOpenInterest > 0 && config.strategy.minOpenInterest > config.strategy.maxOpenInterest) {
    errors.push("MIN_OPEN_INTEREST tidak boleh lebih besar dari MAX_OPEN_INTEREST.");
  }

  if (config.strategy.maxLongShortRatio > 0 && config.strategy.minLongShortRatio > config.strategy.maxLongShortRatio) {
    errors.push("MIN_LONG_SHORT_RATIO tidak boleh lebih besar dari MAX_LONG_SHORT_RATIO.");
  }

  const validEntryModes = new Set(["breakout_close", "breakout_retest", "pullback_trend"]);
  if (!validEntryModes.has(config.strategy.entryMode)) {
    errors.push("ENTRY_MODE tidak valid. Gunakan breakout_close, breakout_retest, atau pullback_trend.");
  }

  const validRiskModes = new Set(["fixed_notional", "fixed_margin", "risk_percent_equity", "volatility_target"]);
  if (!validRiskModes.has(config.paper.riskMode)) {
    errors.push("PAPER_TRADING_RISK_MODE tidak valid. Gunakan fixed_notional, fixed_margin, risk_percent_equity, atau volatility_target.");
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
}
