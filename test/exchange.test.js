import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMarketAccuracyReport,
  getMarketMetadata,
  getOrderBookLevelNotional
} from "../src/exchange.js";

function exchange(markets) {
  return {
    id: "testex",
    markets
  };
}

test("getMarketMetadata normalizes CCXT futures fields", () => {
  const metadata = getMarketMetadata(exchange({
    "BTC/USDT:USDT": {
      id: "BTCUSDT",
      symbol: "BTC/USDT:USDT",
      base: "BTC",
      quote: "USDT",
      settle: "USDT",
      type: "swap",
      swap: true,
      contract: true,
      linear: true,
      inverse: false,
      contractSize: 0.001,
      precision: { price: 0.1, amount: 1 },
      limits: { amount: { min: 1 }, cost: { min: 5 } }
    }
  }), "BTC/USDT:USDT");

  assert.equal(metadata.symbol, "BTC/USDT:USDT");
  assert.equal(metadata.contract, true);
  assert.equal(metadata.linear, true);
  assert.equal(metadata.contractSize, 0.001);
  assert.equal(metadata.contractSizeValid, true);
  assert.equal(metadata.minCost, 5);
});

test("getOrderBookLevelNotional accounts for spot, linear contracts, and inverse contracts", () => {
  assert.equal(getOrderBookLevelNotional([100, 2], { contract: false }), 200);
  assert.equal(getOrderBookLevelNotional([100, 10], { contract: true, linear: true, inverse: false, contractSize: 0.001 }), 1);
  assert.equal(getOrderBookLevelNotional([100, 10], { contract: true, linear: false, inverse: true, contractSize: 100 }), 1000);
});

test("buildMarketAccuracyReport accepts matching swap contracts", () => {
  const report = buildMarketAccuracyReport({
    exchange: exchange({
      "ETH/USDT:USDT": {
        symbol: "ETH/USDT:USDT",
        type: "swap",
        swap: true,
        contract: true,
        linear: true,
        inverse: false,
        settle: "USDT",
        contractSize: 0.01
      }
    }),
    symbols: ["ETH/USDT:USDT"],
    marketType: "swap"
  });

  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
  assert.equal(report.markets.get("ETH/USDT:USDT").contractSize, 0.01);
});

test("buildMarketAccuracyReport rejects missing or spot symbols for futures market types", () => {
  const report = buildMarketAccuracyReport({
    exchange: exchange({
      "BTC/USDT": {
        symbol: "BTC/USDT",
        type: "spot",
        spot: true,
        contract: false
      }
    }),
    symbols: ["BTC/USDT", "DOGE/USDT:USDT"],
    marketType: "swap"
  });

  assert.ok(report.errors.includes("BTC/USDT bukan futures/swap contract market untuk MARKET_TYPE=swap."));
  assert.ok(report.errors.includes("Symbol DOGE/USDT:USDT tidak ditemukan di exchange testex."));
});

test("buildMarketAccuracyReport warns when derivative metadata is incomplete", () => {
  const report = buildMarketAccuracyReport({
    exchange: exchange({
      "BTC/USD:BTC": {
        symbol: "BTC/USD:BTC",
        type: "swap",
        swap: true,
        contract: true,
        contractSize: 100
      }
    }),
    symbols: ["BTC/USD:BTC"],
    marketType: "swap"
  });

  assert.deepEqual(report.errors, []);
  assert.ok(report.warnings.includes("BTC/USD:BTC tidak punya metadata linear/inverse dari CCXT."));
  assert.ok(report.warnings.includes("BTC/USD:BTC tidak punya settle/margin coin di metadata CCXT."));
});

test("buildMarketAccuracyReport rejects invalid contract size metadata", () => {
  const report = buildMarketAccuracyReport({
    exchange: exchange({
      "BTC/USDT:USDT": {
        symbol: "BTC/USDT:USDT",
        type: "swap",
        swap: true,
        contract: true,
        linear: true,
        inverse: false,
        settle: "USDT",
        contractSize: 0
      }
    }),
    symbols: ["BTC/USDT:USDT"],
    marketType: "swap"
  });

  assert.ok(report.errors.includes("BTC/USDT:USDT contractSize tidak valid."));
});
