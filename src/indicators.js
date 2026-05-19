function isValidNumber(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

export function sma(values, period) {
  const result = Array(values.length).fill(null);
  let sum = 0;
  let count = 0;

  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];

    if (isValidNumber(value)) {
      sum += value;
      count += 1;
    }

    if (i >= period) {
      const oldValue = values[i - period];
      if (isValidNumber(oldValue)) {
        sum -= oldValue;
        count -= 1;
      }
    }

    if (i >= period - 1 && count === period) {
      result[i] = sum / period;
    }
  }

  return result;
}

export function ema(values, period) {
  const result = Array(values.length).fill(null);
  const multiplier = 2 / (period + 1);

  let previousEma = null;
  const buffer = [];

  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];

    if (!isValidNumber(value)) {
      result[i] = null;
      continue;
    }

    if (previousEma === null) {
      buffer.push(Number(value));

      if (buffer.length > period) {
        buffer.shift();
      }

      if (buffer.length === period) {
        previousEma = buffer.reduce((sum, item) => sum + item, 0) / period;
        result[i] = previousEma;
      }
    } else {
      previousEma = Number(value) * multiplier + previousEma * (1 - multiplier);
      result[i] = previousEma;
    }
  }

  return result;
}

export function rsi(values, period = 14) {
  const result = Array(values.length).fill(null);

  if (values.length <= period) return result;

  let gainSum = 0;
  let lossSum = 0;

  for (let i = 1; i <= period; i += 1) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gainSum += change;
    else lossSum += Math.abs(change);
  }

  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;

  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < values.length; i += 1) {
    const change = values[i] - values[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }

  return result;
}

export function macd(values, fastLength = 12, slowLength = 26, signalLength = 9) {
  const fastEma = ema(values, fastLength);
  const slowEma = ema(values, slowLength);

  const macdLine = values.map((_, index) => {
    if (!isValidNumber(fastEma[index]) || !isValidNumber(slowEma[index])) return null;
    return fastEma[index] - slowEma[index];
  });

  const signalLine = ema(macdLine, signalLength);

  const histogram = values.map((_, index) => {
    if (!isValidNumber(macdLine[index]) || !isValidNumber(signalLine[index])) return null;
    return macdLine[index] - signalLine[index];
  });

  return { macdLine, signalLine, histogram };
}

export function trueRange(highs, lows, closes) {
  const result = Array(highs.length).fill(null);

  for (let i = 0; i < highs.length; i += 1) {
    if (i === 0) {
      result[i] = highs[i] - lows[i];
    } else {
      result[i] = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i - 1]),
        Math.abs(lows[i] - closes[i - 1])
      );
    }
  }

  return result;
}

export function rma(values, period) {
  const result = Array(values.length).fill(null);

  let previous = null;
  let sum = 0;
  let count = 0;

  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];

    if (!isValidNumber(value)) {
      result[i] = null;
      continue;
    }

    if (previous === null) {
      sum += Number(value);
      count += 1;

      if (count === period) {
        previous = sum / period;
        result[i] = previous;
      }
    } else {
      previous = (previous * (period - 1) + Number(value)) / period;
      result[i] = previous;
    }
  }

  return result;
}

export function atr(highs, lows, closes, period = 14) {
  return rma(trueRange(highs, lows, closes), period);
}

export function dmi(highs, lows, closes, period = 14, smoothing = 14) {
  const tr = trueRange(highs, lows, closes);
  const plusDM = Array(highs.length).fill(null);
  const minusDM = Array(highs.length).fill(null);

  plusDM[0] = 0;
  minusDM[0] = 0;

  for (let i = 1; i < highs.length; i += 1) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];

    plusDM[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDM[i] = downMove > upMove && downMove > 0 ? downMove : 0;
  }

  const smoothedTR = rma(tr, period);
  const smoothedPlusDM = rma(plusDM, period);
  const smoothedMinusDM = rma(minusDM, period);

  const plusDI = highs.map((_, index) => {
    if (!isValidNumber(smoothedTR[index]) || smoothedTR[index] === 0) return null;
    return 100 * smoothedPlusDM[index] / smoothedTR[index];
  });

  const minusDI = highs.map((_, index) => {
    if (!isValidNumber(smoothedTR[index]) || smoothedTR[index] === 0) return null;
    return 100 * smoothedMinusDM[index] / smoothedTR[index];
  });

  const dx = highs.map((_, index) => {
    if (!isValidNumber(plusDI[index]) || !isValidNumber(minusDI[index])) return null;

    const denominator = plusDI[index] + minusDI[index];
    if (denominator === 0) return 0;

    return 100 * Math.abs(plusDI[index] - minusDI[index]) / denominator;
  });

  const adx = rma(dx, smoothing);

  return { plusDI, minusDI, adx };
}

export function highest(values, endIndex, length) {
  const start = Math.max(0, endIndex - length + 1);
  let best = null;

  for (let i = start; i <= endIndex; i += 1) {
    if (!isValidNumber(values[i])) continue;
    if (best === null || values[i] > best) best = values[i];
  }

  return best;
}

export function lowest(values, endIndex, length) {
  const start = Math.max(0, endIndex - length + 1);
  let best = null;

  for (let i = start; i <= endIndex; i += 1) {
    if (!isValidNumber(values[i])) continue;
    if (best === null || values[i] < best) best = values[i];
  }

  return best;
}

export function findPivotHighs(candles, left = 3, right = 3, maxCandidates = 40) {
  const result = [];

  for (let i = candles.length - 1 - right; i >= left; i -= 1) {
    const level = candles[i].high;
    let isPivot = true;

    for (let j = i - left; j <= i + right; j += 1) {
      if (j === i) continue;
      if (candles[j].high > level) {
        isPivot = false;
        break;
      }
    }

    if (isPivot) {
      result.push({
        level,
        volume: candles[i].volume,
        timestamp: candles[i].timestamp,
        index: i
      });
    }

    if (result.length >= maxCandidates) break;
  }

  return result;
}

export function findPivotLows(candles, left = 3, right = 3, maxCandidates = 40) {
  const result = [];

  for (let i = candles.length - 1 - right; i >= left; i -= 1) {
    const level = candles[i].low;
    let isPivot = true;

    for (let j = i - left; j <= i + right; j += 1) {
      if (j === i) continue;
      if (candles[j].low < level) {
        isPivot = false;
        break;
      }
    }

    if (isPivot) {
      result.push({
        level,
        volume: candles[i].volume,
        timestamp: candles[i].timestamp,
        index: i
      });
    }

    if (result.length >= maxCandidates) break;
  }

  return result;
}
