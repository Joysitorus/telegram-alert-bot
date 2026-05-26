import test from "node:test";
import assert from "node:assert/strict";
import {
  addPaperTrade,
  createDefaultState,
  evaluateLessonForSignal,
  getPaperAccountState,
  getLessonSummary,
  recordLessonsFromClosedTrades,
  updatePaperTradeOutcomes
} from "../src/state.js";

const basePaperConfig = {
  initialBalance: 100,
  positionNotional: 500,
  leverage: 75,
  maintenanceMarginPercent: 0.5,
  feePercent: 0,
  slippagePercent: 0,
  maxOpenTrades: 0,
  riskMode: "fixed_notional",
  minLiquidationBufferPercent: 0,
  dailyLossLimitUsdt: 0,
  maxDrawdownPercent: 0,
  maxOpenNotional: 0,
  maxUsedMargin: 0,
  breakEvenAfterTp1: false,
  trailAfterTp2: false
};

function signal(overrides = {}) {
  return {
    exchange: "x",
    symbol: "BTC/USDT:USDT",
    timeframe: "15m",
    direction: "BUY",
    directionValue: 1,
    entry: 100,
    sl: 95,
    tp1: 110,
    tp2: 120,
    tp3: 130,
    tp1ExitPortion: 0.5,
    tp2ExitPortion: 0.3,
    tp3ExitPortion: 0.2,
    candleTime: 0,
    score: 7,
    probability: 80,
    ...overrides
  };
}

test("paper trade liquidates before distant stop loss at high leverage", () => {
  const state = createDefaultState();
  const key = "x:BTC/USDT:USDT:15m";
  assert.deepEqual(addPaperTrade(state, key, signal(), basePaperConfig), { added: false, reason: "liquidation_before_sl" });
});

test("paper trade updates balance and releases margin on partial targets", () => {
  const state = createDefaultState();
  const key = "x:BTC/USDT:USDT:15m";
  const config = { ...basePaperConfig, leverage: 10 };
  assert.equal(addPaperTrade(state, key, signal({ sl: 92 }), config).added, true);

  const result = updatePaperTradeOutcomes(state, key, [
    { timestamp: 1, open: 100, high: 111, low: 99, close: 110, volume: 1 },
    { timestamp: 2, open: 110, high: 121, low: 109, close: 120, volume: 1 }
  ], { paperConfig: config });

  assert.deepEqual(result.events.map((event) => event.type), ["TP1_HIT", "TP2_HIT"]);
  const account = getPaperAccountState(state, config);
  assert.equal(account.balance, 155);
  assert.equal(account.usedMargin, 10);
});

test("daily loss limit rejects new paper trades", () => {
  const state = createDefaultState();
  const key = "x:BTC/USDT:USDT:15m";
  const config = { ...basePaperConfig, leverage: 10, dailyLossLimitUsdt: 5 };
  const account = getPaperAccountState(state, config);
  account.currentDay = new Date().toISOString().slice(0, 10);
  account.dailyPnl = -5;

  const result = addPaperTrade(state, key, signal({ sl: 92 }), config);
  assert.equal(result.added, false);
  assert.equal(result.reason, "daily_loss_limit");
});

test("lesson records closed trades and rejects weak repeated setup", () => {
  const state = createDefaultState();
  const closedTrades = Array.from({ length: 3 }, (_, index) => ({
    ...signal({
      candleTime: index,
      direction: "BUY",
      directionValue: 1,
      entryMode: "breakout_close",
      rr: 2,
      slRiskPercent: 2,
      marketRegime: { trendRegime: "trending", volatilityRegime: "low_volatility", labels: ["trending", "low_volatility"] }
    }),
    id: `trade:x:BTC/USDT:USDT:15m:${index}:BUY`,
    strategyVersion: "test",
    outcome: "SL",
    realizedR: -1,
    pnlPercent: -2,
    openedAt: index,
    closedAt: index + 1,
    openCandleCount: 1
  }));

  const recordResult = recordLessonsFromClosedTrades(state, closedTrades, { source: "signal" });
  assert.equal(recordResult.added, 3);
  assert.equal(getLessonSummary(state).totalLessons, 3);

  const evaluation = evaluateLessonForSignal(state, {
    ...signal({
      entryMode: "breakout_close",
      rr: 2,
      slRiskPercent: 2,
      marketRegime: { trendRegime: "trending", volatilityRegime: "low_volatility", labels: ["trending", "low_volatility"] }
    })
  }, {
    enabled: true,
    applyFilter: true,
    minSamples: 3,
    minWinRate: 35,
    minAvgR: 0,
    maxLosingStreak: 3
  });

  assert.equal(evaluation.passes, false);
  assert.equal(evaluation.reason, "lesson_losing_streak");
});
