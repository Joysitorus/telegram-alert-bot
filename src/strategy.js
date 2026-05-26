import {
  sma,
  ema,
  rsi,
  macd,
  atr,
  dmi,
  highest,
  lowest,
  findPivotHighs,
  findPivotLows
} from "./indicators.js";

function getProbability(score) {
  if (score === 3) return 50;
  if (score === 4) return 58;
  if (score === 5) return 66;
  if (score === 6) return 73;
  if (score >= 7) return 80;
  return 0;
}

function getMarketRegime({ adxValue, atrValue, close, cfg }) {
  const atrPercent = close > 0 && atrValue > 0 ? atrValue / close * 100 : 0;
  const trendRegime = adxValue >= cfg.marketRegimeTrendAdx ? "trending" : "ranging";
  const volatilityRegime = atrPercent >= cfg.marketRegimeHighVolAtrPercent ? "high_volatility" : "low_volatility";

  return {
    trendRegime,
    volatilityRegime,
    atrPercent,
    labels: [trendRegime, volatilityRegime]
  };
}

function passesMarketRegimeFilter(marketRegime, cfg) {
  const filters = (cfg.marketRegimeFilter || []).map((item) => String(item).toLowerCase());
  if (filters.length === 0) return true;

  const trendFilters = filters.filter((item) => item === "trending" || item === "ranging");
  const volatilityFilters = filters.filter((item) => item === "high_volatility" || item === "low_volatility");
  const trendPasses = trendFilters.length === 0 || trendFilters.includes(marketRegime.trendRegime);
  const volatilityPasses = volatilityFilters.length === 0 || volatilityFilters.includes(marketRegime.volatilityRegime);

  return trendPasses && volatilityPasses;
}

function getCandleQuality(candle, volumeMaValue) {
  const range = candle.high - candle.low;
  const body = Math.abs(candle.close - candle.open);
  const upperWick = candle.high - Math.max(candle.close, candle.open);
  const lowerWick = Math.min(candle.close, candle.open) - candle.low;

  return {
    bodyPercent: range > 0 ? body / range * 100 : 0,
    upperWickPercent: range > 0 ? upperWick / range * 100 : 0,
    lowerWickPercent: range > 0 ? lowerWick / range * 100 : 0,
    volumeRatio: volumeMaValue > 0 ? candle.volume / volumeMaValue : 0
  };
}

function passesSignalQuality({ side, current, prevHigh, prevLow, atrValue, emaFastValue, quality, liquidity, cfg }) {
  const rejectionReasons = [];
  const breakoutDistanceAtr = side === "BUY"
    ? atrValue > 0 ? (current.close - prevHigh) / atrValue : 0
    : atrValue > 0 ? (prevLow - current.close) / atrValue : 0;
  const extensionAtr = atrValue > 0 ? Math.abs(current.close - emaFastValue) / atrValue : 0;
  const entryWickPercent = side === "BUY" ? quality.upperWickPercent : quality.lowerWickPercent;

  if (cfg.entryMode === "breakout_close" && breakoutDistanceAtr < cfg.minBreakoutAtr) {
    rejectionReasons.push("breakout_atr_too_small");
  }
  if (cfg.maxBreakoutExtensionAtr > 0 && extensionAtr > cfg.maxBreakoutExtensionAtr) {
    rejectionReasons.push("breakout_extension_too_far");
  }
  if (quality.bodyPercent < cfg.minCandleBodyPercent) {
    rejectionReasons.push("body_too_small");
  }
  if (entryWickPercent > cfg.maxEntryWickPercent) {
    rejectionReasons.push("entry_wick_too_large");
  }
  if (cfg.minVolumeRatio > 0 && quality.volumeRatio < cfg.minVolumeRatio) {
    rejectionReasons.push("volume_ratio_too_low");
  }
  if (cfg.rejectFallbackLiquidityTarget && liquidity.source === "fallback_min_rr") {
    rejectionReasons.push("fallback_liquidity_target");
  }

  return {
    passes: rejectionReasons.length === 0,
    rejectionReasons,
    breakoutDistanceAtr,
    extensionAtr,
    entryWickPercent
  };
}

function getOrderBlockScore({ displacementAtr, volumeRatio, age, zoneAtr }) {
  const displacementScore = Math.min(displacementAtr, 4) * 20;
  const volumeScore = Math.min(volumeRatio, 3) * 15;
  const freshnessScore = Math.max(0, 25 - age * 0.35);
  const zonePenalty = Math.max(0, zoneAtr - 1) * 10;

  return Math.max(0, displacementScore + volumeScore + freshnessScore - zonePenalty);
}

function getOrderBlockValidation({ side, entry, candles, atrValues, volumeMaValues, cfg, endIndex }) {
  const start = Math.max(1, endIndex - cfg.orderBlockLookback);
  let best = null;

  for (let index = endIndex - 1; index >= start; index -= 1) {
    const candle = candles[index];
    const atrValue = atrValues[index];
    if (!atrValue || atrValue <= 0) continue;

    const isBullishObCandle = side === "BUY" && candle.close < candle.open;
    const isBearishObCandle = side === "SELL" && candle.close > candle.open;
    if (!isBullishObCandle && !isBearishObCandle) continue;

    const impulseEnd = Math.min(endIndex, index + cfg.orderBlockImpulseLookahead);
    let impulseClose = candle.close;

    for (let j = index + 1; j <= impulseEnd; j += 1) {
      impulseClose = side === "BUY"
        ? Math.max(impulseClose, candles[j].close)
        : Math.min(impulseClose, candles[j].close);
    }

    const displacement = side === "BUY"
      ? impulseClose - candle.high
      : candle.low - impulseClose;
    const displacementAtr = displacement / atrValue;
    if (displacementAtr < cfg.orderBlockMinDisplacementATR) continue;

    const zoneLow = side === "BUY" ? candle.low : candle.open;
    const zoneHigh = side === "BUY" ? candle.open : candle.high;
    const zoneSize = zoneHigh - zoneLow;
    const zoneAtr = zoneSize / atrValue;
    if (zoneSize <= 0 || zoneAtr > cfg.orderBlockMaxZoneATR) continue;

    const maxDistance = atrValues[endIndex] * cfg.orderBlockMaxEntryDistanceATR;
    const distanceToZone = side === "BUY"
      ? Math.max(0, entry - zoneHigh)
      : Math.max(0, zoneLow - entry);
    const entryNearZone = side === "BUY"
      ? entry >= zoneLow && distanceToZone <= maxDistance
      : entry <= zoneHigh && distanceToZone <= maxDistance;
    if (!entryNearZone) continue;

    const volumeMa = volumeMaValues[index] || 0;
    const volumeRatio = volumeMa > 0 ? candle.volume / volumeMa : 0;
    const age = endIndex - index;
    const score = getOrderBlockScore({ displacementAtr, volumeRatio, age, zoneAtr });

    if (score < cfg.minOrderBlockScore) continue;

    if (!best || score > best.score) {
      best = {
        valid: true,
        score,
        zoneLow,
        zoneHigh,
        timestamp: candle.timestamp,
        age,
        displacementAtr,
        volumeRatio
      };
    }
  }

  return best ?? {
    valid: false,
    score: 0,
    zoneLow: null,
    zoneHigh: null,
    timestamp: null,
    age: null,
    displacementAtr: 0,
    volumeRatio: 0
  };
}

function getSafeStopLoss({ side, entry, orderBlock, highs, lows, atrValue, cfg, endIndex }) {
  const buffer = atrValue > 0 ? atrValue * cfg.safeSlBufferATR : 0;
  const fallbackDistance = entry * (cfg.maxSafeSlPercent / 100);
  const recentLow = lowest(lows, endIndex - 1, cfg.safeSlLookback);
  const recentHigh = highest(highs, endIndex - 1, cfg.safeSlLookback);

  let sl;
  let source;

  if (side === "BUY") {
    const base = Math.min(
      orderBlock?.zoneLow ?? entry,
      recentLow ?? entry
    );

    sl = base - buffer;
    source = orderBlock?.valid ? "order_block_swing_low" : "swing_low";

    if (!Number.isFinite(sl) || sl >= entry) {
      sl = entry - fallbackDistance;
      source = "max_risk_fallback";
    }
  } else {
    const base = Math.max(
      orderBlock?.zoneHigh ?? entry,
      recentHigh ?? entry
    );

    sl = base + buffer;
    source = orderBlock?.valid ? "order_block_swing_high" : "swing_high";

    if (!Number.isFinite(sl) || sl <= entry) {
      sl = entry + fallbackDistance;
      source = "max_risk_fallback";
    }
  }

  const riskPercent = Math.abs(sl - entry) / entry * 100;

  return {
    sl,
    riskPercent,
    valid: riskPercent > 0 && riskPercent <= cfg.maxSafeSlPercent,
    source
  };
}

function countLiquidityTouches({ candles, level, tolerance, lookback, side, endIndex }) {
  const start = Math.max(0, endIndex - lookback);
  let touches = 0;
  let volumeAround = 0;

  for (let i = start; i < endIndex; i += 1) {
    const price = side === "BUY" ? candles[i].high : candles[i].low;
    if (Math.abs(price - level) <= tolerance) {
      touches += 1;
      volumeAround += candles[i].volume;
    }
  }

  return { touches, volumeAround };
}

function getBuyLiquidityTarget({ entry, sl, candles, pivots, atrValue, emaLongValue, volMaValue, cfg, endIndex }) {
  let bestLevel = null;
  let bestScore = null;
  let bestTouches = 0;
  let bestRR = null;

  const risk = entry - sl;
  const tolerance = atrValue * cfg.liquidityToleranceATR;
  const maxDistance = atrValue * cfg.maxTargetATRDistance;

  if (risk > 0 && atrValue > 0) {
    for (const pivot of pivots) {
      const level = pivot.level;
      const distance = level - entry;
      const rr = distance / risk;

      const isAboveEntry = level > entry;
      const distanceOk = distance <= maxDistance;
      const rrOk = rr >= cfg.minRR;

      if (!isAboveEntry || !distanceOk || !rrOk) continue;

      const { touches, volumeAround } = countLiquidityTouches({
        candles,
        level,
        tolerance,
        lookback: cfg.liquidityTouchLookback,
        side: "BUY",
        endIndex
      });

      if (touches < cfg.minLiquidityTouches) continue;

      const volScore = volMaValue > 0 ? volumeAround / volMaValue : 0;
      const trendBonus = entry > emaLongValue ? 10 : 0;
      const rrScore = Math.min(rr, 10) * 3;
      const distancePenalty = atrValue > 0 ? (distance / atrValue) * 0.25 : 0;

      const score = touches * 15 + volScore * 0.10 + rrScore + trendBonus - distancePenalty;

      if (bestScore === null || score > bestScore) {
        bestScore = score;
        bestLevel = level;
        bestTouches = touches;
        bestRR = rr;
      }
    }
  }

  const fallbackTarget = entry + risk * cfg.minRR;

  return {
    level: bestLevel ?? fallbackTarget,
    score: bestScore ?? 0,
    touches: bestLevel === null ? 0 : bestTouches,
    rr: bestRR ?? cfg.minRR,
    source: bestLevel === null ? "fallback_min_rr" : "smart_liquidity"
  };
}

function getSellLiquidityTarget({ entry, sl, candles, pivots, atrValue, emaLongValue, volMaValue, cfg, endIndex }) {
  let bestLevel = null;
  let bestScore = null;
  let bestTouches = 0;
  let bestRR = null;

  const risk = sl - entry;
  const tolerance = atrValue * cfg.liquidityToleranceATR;
  const maxDistance = atrValue * cfg.maxTargetATRDistance;

  if (risk > 0 && atrValue > 0) {
    for (const pivot of pivots) {
      const level = pivot.level;
      const distance = entry - level;
      const rr = distance / risk;

      const isBelowEntry = level < entry;
      const distanceOk = distance <= maxDistance;
      const rrOk = rr >= cfg.minRR;

      if (!isBelowEntry || !distanceOk || !rrOk) continue;

      const { touches, volumeAround } = countLiquidityTouches({
        candles,
        level,
        tolerance,
        lookback: cfg.liquidityTouchLookback,
        side: "SELL",
        endIndex
      });

      if (touches < cfg.minLiquidityTouches) continue;

      const volScore = volMaValue > 0 ? volumeAround / volMaValue : 0;
      const trendBonus = entry < emaLongValue ? 10 : 0;
      const rrScore = Math.min(rr, 10) * 3;
      const distancePenalty = atrValue > 0 ? (distance / atrValue) * 0.25 : 0;

      const score = touches * 15 + volScore * 0.10 + rrScore + trendBonus - distancePenalty;

      if (bestScore === null || score > bestScore) {
        bestScore = score;
        bestLevel = level;
        bestTouches = touches;
        bestRR = rr;
      }
    }
  }

  const fallbackTarget = entry - risk * cfg.minRR;

  return {
    level: bestLevel ?? fallbackTarget,
    score: bestScore ?? 0,
    touches: bestLevel === null ? 0 : bestTouches,
    rr: bestRR ?? cfg.minRR,
    source: bestLevel === null ? "fallback_min_rr" : "smart_liquidity"
  };
}

export function analyzeSymbol({ exchangeId, symbol, timeframe, candles, strategyConfig, pairState = {} }) {
  const cfg = strategyConfig;
  const inCooldown = cfg.cooldownSeconds > 0 && pairState.lastSignalAt && Date.now() - pairState.lastSignalAt < cfg.cooldownSeconds * 1000;

  const requiredCandles = Math.max(
    cfg.emaLong + 60,
    cfg.liquidityTouchLookback + cfg.pivotLeft + cfg.pivotRight + 10,
    cfg.breakoutLength + 60,
    cfg.orderBlockLookback + cfg.orderBlockImpulseLookahead + 10,
    cfg.safeSlLookback + 10
  );

  if (!Array.isArray(candles) || candles.length < requiredCandles) {
    return {
      hasSignal: false,
      reason: `Data candle belum cukup. Diperlukan minimal ${requiredCandles}, tersedia ${candles?.length ?? 0}.`
    };
  }

  const closes = candles.map((candle) => candle.close);
  const highs = candles.map((candle) => candle.high);
  const lows = candles.map((candle) => candle.low);
  const volumes = candles.map((candle) => candle.volume);

  const emaFast = ema(closes, cfg.emaFast);
  const emaMid = ema(closes, cfg.emaMid);
  const emaLong = ema(closes, cfg.emaLong);
  const rsiValues = rsi(closes, cfg.rsiLength);
  const macdValues = macd(closes, 12, 26, 9);
  const volumeMa = sma(volumes, cfg.volumeMaLength);
  const atrValues = atr(highs, lows, closes, cfg.atrLength);
  const dmiValues = dmi(highs, lows, closes, cfg.adxLength, cfg.adxSmoothing);

  const i = candles.length - 1;
  const current = candles[i];
  const previous = candles[i - 1];

  const prevHigh = highest(highs, i - 1, cfg.breakoutLength);
  const prevLow = lowest(lows, i - 1, cfg.breakoutLength);
  const prevPrevHigh = highest(highs, i - 2, cfg.breakoutLength);
  const prevPrevLow = lowest(lows, i - 2, cfg.breakoutLength);

  const bullBreakout = current.close > prevHigh;
  const bearBreakout = current.close < prevLow;
  const bullRetest = previous.close > prevPrevHigh && current.low <= prevPrevHigh && current.close > prevPrevHigh;
  const bearRetest = previous.close < prevPrevLow && current.high >= prevPrevLow && current.close < prevPrevLow;
  const buyPullbackTrend = current.close > emaLong[i] && emaFast[i] > emaMid[i] && current.low <= emaFast[i] && current.close > emaFast[i];
  const sellPullbackTrend = current.close < emaLong[i] && emaFast[i] < emaMid[i] && current.high >= emaFast[i] && current.close < emaFast[i];

  const higherHigh = current.high > previous.high && current.low > previous.low;
  const lowerLow = current.low < previous.low && current.high < previous.high;

  const macdHist = macdValues.histogram[i];
  const prevMacdHist = macdValues.histogram[i - 1];

  const buyConfirmations = [
    current.close > emaLong[i],
    emaFast[i] > emaMid[i],
    rsiValues[i] > 50,
    macdHist > 0 && macdHist > prevMacdHist,
    current.volume > volumeMa[i],
    higherHigh || bullBreakout,
    dmiValues.adx[i] > 20 && dmiValues.plusDI[i] > dmiValues.minusDI[i]
  ];

  const sellConfirmations = [
    current.close < emaLong[i],
    emaFast[i] < emaMid[i],
    rsiValues[i] < 50,
    macdHist < 0 && macdHist < prevMacdHist,
    current.volume > volumeMa[i],
    lowerLow || bearBreakout,
    dmiValues.adx[i] > 20 && dmiValues.minusDI[i] > dmiValues.plusDI[i]
  ];

  const buyScore = buyConfirmations.filter(Boolean).length;
  const sellScore = sellConfirmations.filter(Boolean).length;
  const candleQuality = getCandleQuality(current, volumeMa[i]);
  const marketRegime = getMarketRegime({
    adxValue: dmiValues.adx[i],
    atrValue: atrValues[i],
    close: current.close,
    cfg
  });
  const marketRegimeAllowed = passesMarketRegimeFilter(marketRegime, cfg);

  const buyProb = getProbability(buyScore);
  const sellProb = getProbability(sellScore);

  const highPivots = findPivotHighs(candles, cfg.pivotLeft, cfg.pivotRight, cfg.maxLiquidityCandidates);
  const lowPivots = findPivotLows(candles, cfg.pivotLeft, cfg.pivotRight, cfg.maxLiquidityCandidates);

  const buyEntry = current.close;

  const buyOrderBlock = getOrderBlockValidation({
    side: "BUY",
    entry: buyEntry,
    candles,
    atrValues,
    volumeMaValues: volumeMa,
    cfg,
    endIndex: i
  });

  const buySafeSl = getSafeStopLoss({
    side: "BUY",
    entry: buyEntry,
    orderBlock: buyOrderBlock,
    highs,
    lows,
    atrValue: atrValues[i],
    cfg,
    endIndex: i
  });

  const buySL = buySafeSl.sl;

  const buyLiquidity = getBuyLiquidityTarget({
    entry: buyEntry,
    sl: buySL,
    candles,
    pivots: highPivots,
    atrValue: atrValues[i],
    emaLongValue: emaLong[i],
    volMaValue: volumeMa[i],
    cfg,
    endIndex: i
  });

  const buyTP3 = buyLiquidity.level;
  const buyDistance = buyTP3 - buyEntry;
  const buyTP1 = buyEntry + buyDistance * cfg.tp1Portion;
  const buyTP2 = buyEntry + buyDistance * cfg.tp2Portion;

  const sellEntry = current.close;

  const sellOrderBlock = getOrderBlockValidation({
    side: "SELL",
    entry: sellEntry,
    candles,
    atrValues,
    volumeMaValues: volumeMa,
    cfg,
    endIndex: i
  });

  const sellSafeSl = getSafeStopLoss({
    side: "SELL",
    entry: sellEntry,
    orderBlock: sellOrderBlock,
    highs,
    lows,
    atrValue: atrValues[i],
    cfg,
    endIndex: i
  });

  const sellSL = sellSafeSl.sl;

  const sellLiquidity = getSellLiquidityTarget({
    entry: sellEntry,
    sl: sellSL,
    candles,
    pivots: lowPivots,
    atrValue: atrValues[i],
    emaLongValue: emaLong[i],
    volMaValue: volumeMa[i],
    cfg,
    endIndex: i
  });

  const sellTP3 = sellLiquidity.level;
  const sellDistance = sellEntry - sellTP3;
  const sellTP1 = sellEntry - sellDistance * cfg.tp1Portion;
  const sellTP2 = sellEntry - sellDistance * cfg.tp2Portion;

  const buyEntryPattern = cfg.entryMode === "breakout_retest"
    ? bullRetest
    : cfg.entryMode === "pullback_trend" ? buyPullbackTrend : bullBreakout;
  const sellEntryPattern = cfg.entryMode === "breakout_retest"
    ? bearRetest
    : cfg.entryMode === "pullback_trend" ? sellPullbackTrend : bearBreakout;

  const buySignalRaw = buyScore >= cfg.minConfirm && buyEntryPattern;
  const sellSignalRaw = sellScore >= cfg.minConfirm && sellEntryPattern;

  const buyRRValid = buyLiquidity.rr >= cfg.minRR;
  const sellRRValid = sellLiquidity.rr >= cfg.minRR;

  const buyOrderBlockValid = !cfg.requireOrderBlock || buyOrderBlock.valid;
  const sellOrderBlockValid = !cfg.requireOrderBlock || sellOrderBlock.valid;
  const buyQuality = passesSignalQuality({
    side: "BUY",
    current,
    prevHigh,
    prevLow,
    atrValue: atrValues[i],
    emaFastValue: emaFast[i],
    quality: candleQuality,
    liquidity: buyLiquidity,
    cfg
  });
  const sellQuality = passesSignalQuality({
    side: "SELL",
    current,
    prevHigh,
    prevLow,
    atrValue: atrValues[i],
    emaFastValue: emaFast[i],
    quality: candleQuality,
    liquidity: sellLiquidity,
    cfg
  });

  const buySignal = buySignalRaw && buyRRValid && buyOrderBlockValid && buySafeSl.valid && marketRegimeAllowed && buyQuality.passes;
  const sellSignal = sellSignalRaw && sellRRValid && sellOrderBlockValid && sellSafeSl.valid && marketRegimeAllowed && sellQuality.passes;

  let signal = null;

  const buyDirectionAllowed = cfg.ignoreLastDirectionBlock || pairState.lastDirection !== 1;
  const sellDirectionAllowed = cfg.ignoreLastDirectionBlock || pairState.lastDirection !== -1;

  if (!inCooldown && buySignal && buyDirectionAllowed && pairState.lastSignalCandleTime !== current.timestamp) {
    signal = {
      direction: "BUY",
      directionValue: 1,
      exchange: exchangeId,
      strategyVersion: cfg.version,
      symbol,
      timeframe,
      candleTime: current.timestamp,
      price: current.close,
      entry: buyEntry,
      sl: buySL,
      tp1: buyTP1,
      tp2: buyTP2,
      tp3: buyTP3,
      tp1ExitPortion: cfg.tp1ExitPortion,
      tp2ExitPortion: cfg.tp2ExitPortion,
      tp3ExitPortion: cfg.tp3ExitPortion,
      rr: buyLiquidity.rr,
      probability: buyProb,
      score: buyScore,
      liquidityScore: buyLiquidity.score,
      liquidityTouches: buyLiquidity.touches,
      liquiditySource: buyLiquidity.source,
      orderBlockScore: buyOrderBlock.score,
      orderBlockZoneLow: buyOrderBlock.zoneLow,
      orderBlockZoneHigh: buyOrderBlock.zoneHigh,
      orderBlockAge: buyOrderBlock.age,
      slRiskPercent: buySafeSl.riskPercent,
      slSource: buySafeSl.source,
      marketRegime,
      trend: current.close > emaLong[i] ? "BULLISH" : current.close < emaLong[i] ? "BEARISH" : "NEUTRAL",
      entryMode: cfg.entryMode,
      signalQuality: buyQuality,
      confirmations: buyConfirmations
    };
  }

  if (!inCooldown && sellSignal && sellDirectionAllowed && pairState.lastSignalCandleTime !== current.timestamp) {
    signal = {
      direction: "SELL",
      directionValue: -1,
      exchange: exchangeId,
      strategyVersion: cfg.version,
      symbol,
      timeframe,
      candleTime: current.timestamp,
      price: current.close,
      entry: sellEntry,
      sl: sellSL,
      tp1: sellTP1,
      tp2: sellTP2,
      tp3: sellTP3,
      tp1ExitPortion: cfg.tp1ExitPortion,
      tp2ExitPortion: cfg.tp2ExitPortion,
      tp3ExitPortion: cfg.tp3ExitPortion,
      rr: sellLiquidity.rr,
      probability: sellProb,
      score: sellScore,
      liquidityScore: sellLiquidity.score,
      liquidityTouches: sellLiquidity.touches,
      liquiditySource: sellLiquidity.source,
      orderBlockScore: sellOrderBlock.score,
      orderBlockZoneLow: sellOrderBlock.zoneLow,
      orderBlockZoneHigh: sellOrderBlock.zoneHigh,
      orderBlockAge: sellOrderBlock.age,
      slRiskPercent: sellSafeSl.riskPercent,
      slSource: sellSafeSl.source,
      marketRegime,
      trend: current.close > emaLong[i] ? "BULLISH" : current.close < emaLong[i] ? "BEARISH" : "NEUTRAL",
      entryMode: cfg.entryMode,
      signalQuality: sellQuality,
      confirmations: sellConfirmations
    };
  }

  return {
    hasSignal: Boolean(signal),
    signal,
    debug: {
      exchange: exchangeId,
      symbol,
      timeframe,
      lastCandleTime: current.timestamp,
      close: current.close,
      buyScore,
      sellScore,
      buyProb,
      sellProb,
      bullBreakout,
      bearBreakout,
      bullRetest,
      bearRetest,
      buyPullbackTrend,
      sellPullbackTrend,
      entryMode: cfg.entryMode,
      buyRR: buyLiquidity.rr,
      sellRR: sellLiquidity.rr,
      buyOrderBlockValid: buyOrderBlock.valid,
      sellOrderBlockValid: sellOrderBlock.valid,
      buyOrderBlockScore: buyOrderBlock.score,
      sellOrderBlockScore: sellOrderBlock.score,
      buySlRiskPercent: buySafeSl.riskPercent,
      sellSlRiskPercent: sellSafeSl.riskPercent,
      buySlSource: buySafeSl.source,
      sellSlSource: sellSafeSl.source,
      buyLiquiditySource: buyLiquidity.source,
      sellLiquiditySource: sellLiquidity.source,
      marketRegime,
      marketRegimeAllowed,
      candleQuality,
      buyQuality,
      sellQuality,
      trend: current.close > emaLong[i] ? "BULLISH" : current.close < emaLong[i] ? "BEARISH" : "NEUTRAL",
      inCooldown
    }
  };
}
