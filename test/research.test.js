import test from "node:test";
import assert from "node:assert/strict";
import {
  createDefaultState,
  normalizeState,
  recordMarketSnapshot,
  recordOrderBookSnapshot,
  recordSignalDecision
} from "../src/state.js";

test("research records get stable ids for warehouse sync", () => {
  const state = createDefaultState();

  recordSignalDecision(state, {
    at: 1000,
    exchange: "bitget",
    marketType: "swap",
    symbol: "BTC/USDT:USDT",
    timeframe: "15m",
    candleTime: 900,
    accepted: true,
    direction: "BUY"
  });

  recordMarketSnapshot(state, {
    at: 1001,
    exchange: "bitget",
    marketType: "swap",
    symbol: "BTC/USDT:USDT",
    timeframe: "15m",
    candleTime: 900,
    close: 100
  });

  recordOrderBookSnapshot(state, {
    at: 1002,
    exchange: "bitget",
    marketType: "swap",
    symbol: "BTC/USDT:USDT",
    timestamp: 1002,
    midPrice: 100
  });

  assert.match(state.research.signalDecisions[0].id, /^signal_decision:bitget:BTC_USDT:USDT:15m:1000:900:0$/);
  assert.match(state.research.marketSnapshots[0].id, /^market_snapshot:bitget:BTC_USDT:USDT:15m:1001:900:0$/);
  assert.match(state.research.orderBookSnapshots[0].id, /^order_book_snapshot:bitget:BTC_USDT:USDT:timeframe:1002:1002:0$/);
});

test("research record limits keep the latest rows", () => {
  const state = createDefaultState();

  recordSignalDecision(state, { at: 1, exchange: "x", symbol: "A/USDT", timeframe: "1m" }, 2);
  recordSignalDecision(state, { at: 2, exchange: "x", symbol: "B/USDT", timeframe: "1m" }, 2);
  recordSignalDecision(state, { at: 3, exchange: "x", symbol: "C/USDT", timeframe: "1m" }, 2);

  assert.deepEqual(state.research.signalDecisions.map((decision) => decision.symbol), ["B/USDT", "C/USDT"]);
});

test("normalizeState backfills ids for existing research rows", () => {
  const state = normalizeState({
    research: {
      signalDecisions: [{ at: 10, exchange: "x", symbol: "BTC/USDT", timeframe: "1m", candleTime: 5 }],
      marketSnapshots: [{ at: 11, exchange: "x", symbol: "BTC/USDT", timeframe: "1m", candleTime: 5 }],
      orderBookSnapshots: [{ at: 12, exchange: "x", symbol: "BTC/USDT", timestamp: 12 }],
      lessons: [],
      lessonStats: {}
    },
    performance: {},
    runtime: {}
  });

  assert.match(state.research.signalDecisions[0].id, /^signal_decision:x:BTC_USDT:1m:10:5:0$/);
  assert.match(state.research.marketSnapshots[0].id, /^market_snapshot:x:BTC_USDT:1m:11:5:0$/);
  assert.match(state.research.orderBookSnapshots[0].id, /^order_book_snapshot:x:BTC_USDT:timeframe:12:12:0$/);
});

test("normalizeState tolerates corrupted performance collections", () => {
  const state = normalizeState({
    research: {},
    performance: {
      openTrades: {},
      closedTrades: "bad",
      paperTrades: null
    },
    runtime: {}
  });

  assert.deepEqual(state.performance.openTrades, []);
  assert.deepEqual(state.performance.closedTrades, []);
  assert.deepEqual(state.performance.paperTrades, []);
});
