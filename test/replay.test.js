import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultState, getPerformanceState } from "../src/state.js";
import { buildStrategyReplayWarehouseRecords, runReplaySweep, summarizeReplay } from "../src/replay.js";

function paperTrade(overrides = {}) {
  return {
    symbol: "BTC/USDT:USDT",
    outcome: "TP3",
    tp2Hit: true,
    realizedR: 2,
    realizedPnlUsdt: 10,
    ...overrides
  };
}

test("summarizeReplay reports global and per-symbol metrics", () => {
  const state = createDefaultState();
  const performance = getPerformanceState(state);
  performance.paperTrades = [
    paperTrade({ symbol: "BTC/USDT:USDT", outcome: "TP3", tp2Hit: true, realizedR: 3, realizedPnlUsdt: 15 }),
    paperTrade({ symbol: "BTC/USDT:USDT", outcome: "SL", tp2Hit: false, realizedR: -1, realizedPnlUsdt: -5 }),
    paperTrade({ symbol: "ETH/USDT:USDT", outcome: "LIQUIDATED", tp2Hit: false, realizedR: -1.5, realizedPnlUsdt: -8 }),
    paperTrade({ symbol: "ETH/USDT:USDT", outcome: null, tp2Hit: false, realizedR: 0, realizedPnlUsdt: 0 })
  ];
  performance.paperAccount = {
    rejectedTrades: 2,
    lastRejectReason: "insufficient_balance",
    equityCurve: [
      { balance: 100 },
      { balance: 120 },
      { balance: 90 },
      { balance: 110 }
    ]
  };

  const summary = summarizeReplay(state);

  assert.equal(summary.global.totalTrades, 4);
  assert.equal(summary.global.closedTrades, 3);
  assert.equal(summary.global.openTrades, 1);
  assert.equal(summary.global.wins, 1);
  assert.equal(summary.global.losses, 1);
  assert.equal(summary.global.liquidations, 1);
  assert.equal(summary.global.winrate, 33.33);
  assert.equal(summary.global.averageR, 0.1667);
  assert.equal(summary.global.totalR, 0.5);
  assert.equal(summary.global.realizedPnlUsdt, 2);
  assert.deepEqual(summary.global.outcomes, { TP3: 1, SL: 1, LIQUIDATED: 1 });
  assert.equal(summary.global.maxDrawdownUsdt, 30);
  assert.equal(summary.global.maxDrawdownPercent, 25);
  assert.deepEqual(summary.global.rejected, {
    total: 2,
    reasons: { insufficient_balance: 2 }
  });

  assert.equal(summary.bySymbol["BTC/USDT:USDT"].closedTrades, 2);
  assert.equal(summary.bySymbol["BTC/USDT:USDT"].winrate, 50);
  assert.equal(summary.bySymbol["BTC/USDT:USDT"].totalR, 2);
  assert.equal(summary.bySymbol["ETH/USDT:USDT"].openTrades, 1);
  assert.equal(summary.bySymbol["ETH/USDT:USDT"].liquidations, 1);
});

test("summarizeReplay handles empty replay state", () => {
  const summary = summarizeReplay(createDefaultState());

  assert.equal(summary.global.totalTrades, 0);
  assert.equal(summary.global.winrate, 0);
  assert.equal(summary.global.averageR, 0);
  assert.equal(summary.global.maxDrawdownPercent, 0);
  assert.deepEqual(summary.global.rejected, { total: 0, reasons: {} });
  assert.deepEqual(summary.bySymbol, {});
});

test("summarizeReplay reports walk-forward train and test performance", () => {
  const state = createDefaultState();
  const performance = getPerformanceState(state);
  performance.paperTrades = [
    paperTrade({ symbol: "BTC/USDT:USDT", openedAt: 3_000, closedAt: 4_000, realizedR: 2, realizedPnlUsdt: 20 }),
    paperTrade({ symbol: "BTC/USDT:USDT", openedAt: 5_000, closedAt: 6_000, outcome: "SL", tp2Hit: false, realizedR: -1, realizedPnlUsdt: -10 }),
    paperTrade({ symbol: "BTC/USDT:USDT", openedAt: 8_000, closedAt: 9_000, realizedR: 1.5, realizedPnlUsdt: 15 })
  ];

  const candles = Array.from({ length: 10 }, (_, index) => ({
    timestamp: (index + 1) * 1_000,
    open: 1,
    high: 1,
    low: 1,
    close: 1,
    volume: 1
  }));
  const summary = summarizeReplay(state, {
    walkForward: {
      candlesBySymbol: { "BTC/USDT:USDT": candles },
      trainRatio: 0.7
    }
  });

  assert.equal(summary.walkForward.trainRatio, 0.7);
  assert.equal(summary.walkForward.testRatio, 0.3);
  assert.equal(summary.walkForward.bySymbol["BTC/USDT:USDT"].trainWindow.candleCount, 7);
  assert.equal(summary.walkForward.bySymbol["BTC/USDT:USDT"].testWindow.candleCount, 3);
  assert.equal(summary.walkForward.global.train.closedTrades, 2);
  assert.equal(summary.walkForward.global.train.totalR, 1);
  assert.equal(summary.walkForward.global.train.averageR, 0.5);
  assert.equal(summary.walkForward.global.train.maxDrawdownR, 1);
  assert.equal(summary.walkForward.global.test.closedTrades, 1);
  assert.equal(summary.walkForward.global.test.totalR, 1.5);
  assert.equal(summary.walkForward.global.comparison.averageRDelta, 1);
  assert.equal(summary.walkForward.global.comparison.closedTradeDelta, -1);
  assert.equal(summary.walkForward.global.unassignedTrades, 0);
});

test("runReplaySweep builds bounded ranking output from custom search space", () => {
  const previous = {
    REPLAY_SWEEP_SPACE_JSON: process.env.REPLAY_SWEEP_SPACE_JSON,
    REPLAY_SWEEP_MAX_CONFIGS: process.env.REPLAY_SWEEP_MAX_CONFIGS,
    REPLAY_SWEEP_TOP: process.env.REPLAY_SWEEP_TOP,
    REPLAY_SWEEP_MIN_TEST_TRADES: process.env.REPLAY_SWEEP_MIN_TEST_TRADES
  };

  try {
    process.env.REPLAY_SWEEP_SPACE_JSON = JSON.stringify({
      MIN_CONFIRM: [5, 6],
      MIN_RR: [2],
      ENTRY_MODE: ["breakout_close"],
      MIN_VOLUME_RATIO: [0],
      MAX_ENTRY_WICK_PERCENT: [35]
    });
    process.env.REPLAY_SWEEP_MAX_CONFIGS = "3";
    process.env.REPLAY_SWEEP_TOP = "2";
    process.env.REPLAY_SWEEP_MIN_TEST_TRADES = "1";

    const candles = Array.from({ length: 20 }, (_, index) => ({
      timestamp: (index + 1) * 1_000,
      open: 1,
      high: 1,
      low: 1,
      close: 1,
      volume: 1
    }));
    const output = runReplaySweep({ "BTC/USDT:USDT": candles }, { trainRatio: 0.7 });

    assert.equal(output.method, "bounded_grid_sweep_with_walk_forward_ranking");
    assert.equal(output.totalCombinations, 2);
    assert.ok(output.evaluatedCombinations <= 3);
    assert.equal(output.ranking.length, Math.min(2, output.evaluatedCombinations));
    assert.ok(output.ranking[0].parameters.minConfirm);
    assert.ok(Array.isArray(output.ranking[0].flags));
    assert.equal(output.minTestTrades, 1);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("buildStrategyReplayWarehouseRecords creates comparable run and result rows", () => {
  const output = {
    generatedAt: "2026-05-30T00:00:00.000Z",
    method: "bounded_grid_sweep_with_walk_forward_ranking",
    trainRatio: 0.7,
    totalCombinations: 2,
    evaluatedCombinations: 2,
    evaluated: [
      {
        id: "sweep_0001",
        parameters: { minConfirm: 5 },
        score: 1.25,
        flags: [],
        train: { closedTrades: 3, averageR: 0.5, totalR: 1.5, maxDrawdownR: 0.5 },
        test: { closedTrades: 2, averageR: 0.4, totalR: 0.8, maxDrawdownR: 0.3 },
        comparison: { averageRDelta: -0.1 }
      },
      {
        id: "sweep_0002",
        parameters: { minConfirm: 6 },
        score: -1,
        flags: ["low_test_trade_count"],
        train: { closedTrades: 2, averageR: 0.2, totalR: 0.4, maxDrawdownR: 0.2 },
        test: { closedTrades: 0, averageR: 0, totalR: 0, maxDrawdownR: 0 },
        comparison: { averageRDelta: -0.2 }
      }
    ]
  };

  const records = buildStrategyReplayWarehouseRecords(output, {
    runId: "run_1",
    runType: "sweep",
    source: "database"
  });

  assert.equal(records.run.id, "run_1");
  assert.equal(records.run.runType, "sweep");
  assert.equal(records.run.source, "database");
  assert.equal(records.run.totalConfigs, 2);
  assert.equal(records.results.length, 2);
  assert.equal(records.results[0].id, "run_1:sweep_0001");
  assert.equal(records.results[0].rank, 1);
  assert.equal(records.results[0].score, 1.25);
  assert.deepEqual(records.results[1].flags, ["low_test_trade_count"]);
});
