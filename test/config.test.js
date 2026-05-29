import test from "node:test";
import assert from "node:assert/strict";
import {
  buildConfigValidationErrors,
  config,
  validateConfig
} from "../src/config.js";

function validConfig(overrides = {}) {
  const base = structuredClone(config);
  const merged = {
    ...base,
    ...overrides,
    telegram: { ...base.telegram, botToken: "token", chatId: "123", ...(overrides.telegram || {}) },
    exchange: { ...base.exchange, symbols: ["BTC/USDT:USDT"], timeframe: "15m", ...(overrides.exchange || {}) },
    runtime: { ...base.runtime, databaseUrl: "", ...(overrides.runtime || {}) },
    performance: { ...base.performance, reportTimezone: "Asia/Jakarta", ...(overrides.performance || {}) },
    backup: { ...base.backup, timezone: "Asia/Jakarta", ...(overrides.backup || {}) },
    marketData: { ...base.marketData, analysisLimit: 1000, ...(overrides.marketData || {}) },
    orderBookLiquidity: { ...base.orderBookLiquidity, enabled: true, depthLimit: 100, ...(overrides.orderBookLiquidity || {}) },
    paper: {
      ...base.paper,
      enabled: false,
      initialBalance: 100,
      positionNotional: 500,
      leverage: 10,
      fixedMargin: 10,
      riskPercentEquity: 1,
      ...(overrides.paper || {})
    },
    lesson: { ...base.lesson, enabled: true, applyFilter: true, minSamples: 8, ...(overrides.lesson || {}) },
    strategy: {
      ...base.strategy,
      emaFast: 20,
      emaMid: 50,
      emaLong: 200,
      tp1Portion: 0.33,
      tp2Portion: 0.66,
      tp1ExitPortion: 0.33,
      tp2ExitPortion: 0.33,
      entryMode: "breakout_close",
      customProfiles: {},
      symbolOverrides: {},
      higherTimeframe: "",
      requireHigherTimeframeTrend: false,
      marketRegimeFilter: [],
      minOpenInterest: 0,
      maxOpenInterest: 0,
      minLongShortRatio: 0,
      maxLongShortRatio: 0,
      maxAbsFundingRate: 0,
      maxPositiveFundingLong: 0,
      maxNegativeFundingShort: 0,
      profile: "",
      ...(overrides.strategy || {})
    }
  };

  return merged;
}

test("validateConfig accepts a complete valid config object", () => {
  assert.doesNotThrow(() => validateConfig(validConfig()));
  assert.deepEqual(buildConfigValidationErrors(validConfig()), []);
});

test("validateConfig reports required fields and malformed timeframe together", () => {
  const errors = buildConfigValidationErrors(validConfig({
    telegram: { botToken: "", chatId: "" },
    exchange: { id: "", symbols: [], timeframe: "15x" }
  }));

  assert.ok(errors.includes("TELEGRAM_BOT_TOKEN belum diisi."));
  assert.ok(errors.includes("TELEGRAM_CHAT_ID belum diisi."));
  assert.ok(errors.includes("EXCHANGE belum diisi."));
  assert.ok(errors.includes("SYMBOLS belum diisi."));
  assert.ok(errors.includes("TIMEFRAME tidak valid. Contoh valid: 1m, 15m, 1h, 4h, 1d."));
});

test("validateConfig rejects invalid enums and numeric relationships", () => {
  assert.throws(() => validateConfig(validConfig({
    exchange: { marketType: "perpetual" },
    strategy: {
      emaFast: 50,
      emaMid: 20,
      emaLong: 20,
      tp1Portion: 0.7,
      tp2Portion: 0.6,
      tp1ExitPortion: 0.8,
      tp2ExitPortion: 0.4,
      entryMode: "instant"
    },
    paper: { riskMode: "kelly" }
  })), /MARKET_TYPE tidak valid[\s\S]*ENTRY_MODE tidak valid[\s\S]*PAPER_TRADING_RISK_MODE tidak valid/);
});

test("validateConfig enforces higher timeframe requirements", () => {
  const missingHigherTimeframe = buildConfigValidationErrors(validConfig({
    strategy: { requireHigherTimeframeTrend: true, higherTimeframe: "" }
  }));
  assert.ok(missingHigherTimeframe.includes("HIGHER_TIMEFRAME wajib diisi saat REQUIRE_HIGHER_TIMEFRAME_TREND=true."));

  const smallerHigherTimeframe = buildConfigValidationErrors(validConfig({
    exchange: { timeframe: "1h" },
    strategy: { higherTimeframe: "15m" }
  }));
  assert.ok(smallerHigherTimeframe.includes("HIGHER_TIMEFRAME harus lebih besar dari TIMEFRAME."));
});

test("validateConfig enforces paper trading sizing for active risk modes", () => {
  const fixedMarginErrors = buildConfigValidationErrors(validConfig({
    paper: { enabled: true, riskMode: "fixed_margin", fixedMargin: 0 }
  }));
  assert.ok(fixedMarginErrors.includes("PAPER_TRADING_FIXED_MARGIN harus lebih besar dari 0 untuk risk mode fixed_margin."));

  const riskPercentErrors = buildConfigValidationErrors(validConfig({
    paper: { enabled: true, riskMode: "risk_percent_equity", riskPercentEquity: 0 }
  }));
  assert.ok(riskPercentErrors.includes("PAPER_TRADING_RISK_PERCENT_EQUITY harus lebih besar dari 0 untuk risk mode risk_percent_equity/volatility_target."));
});

test("validateConfig validates strategy profile and symbol override JSON shapes", () => {
  const errors = buildConfigValidationErrors(validConfig({
    strategy: {
      customProfiles: { aggressive: { entryMode: "market", minRR: 0 } },
      symbolOverrides: { BTCUSDT: { cooldownSeconds: -1 } }
    }
  }));

  assert.ok(errors.includes("STRATEGY_PROFILES_JSON.aggressive.minRR harus lebih besar dari 0."));
  assert.ok(errors.includes("STRATEGY_PROFILES_JSON.aggressive.entryMode tidak valid. Gunakan breakout_close, breakout_retest, atau pullback_trend."));
  assert.ok(errors.includes("SYMBOL_STRATEGY_OVERRIDES_JSON berisi symbol tidak valid: BTCUSDT."));
  assert.ok(errors.includes("SYMBOL_STRATEGY_OVERRIDES_JSON.BTCUSDT.cooldownSeconds tidak boleh negatif."));
});

test("validateConfig rejects unknown strategy profile names", () => {
  assert.throws(() => validateConfig(validConfig({
    strategy: { profile: "typo_profile" }
  })), /STRATEGY_PROFILE tidak dikenal: typo_profile/);

  assert.doesNotThrow(() => validateConfig(validConfig({
    strategy: {
      profile: "custom_scalp",
      customProfiles: {
        custom_scalp: { minConfirm: 6, minRR: 2.5 }
      }
    }
  })));
});
