import fs from "fs";
import path from "path";

export function loadState(stateFile) {
  try {
    if (!fs.existsSync(stateFile)) {
      return { pairs: {} };
    }

    const raw = fs.readFileSync(stateFile, "utf8");
    const parsed = JSON.parse(raw);

    if (!parsed.pairs) parsed.pairs = {};
    return parsed;
  } catch (error) {
    console.warn(`Gagal membaca state file, membuat state baru. Error: ${error.message}`);
    return { pairs: {} };
  }
}

export function saveState(stateFile, state) {
  const directory = path.dirname(stateFile);

  if (directory && directory !== "." && !fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }

  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

export function getPairState(state, key) {
  if (!state.pairs) state.pairs = {};
  if (!state.pairs[key]) {
    state.pairs[key] = {
      lastDirection: 0,
      lastSignalCandleTime: null,
      lastSignalAt: null
    };
  }

  return state.pairs[key];
}

export function updatePairState(state, key, signal) {
  const pairState = getPairState(state, key);

  pairState.lastDirection = signal.directionValue;
  pairState.lastSignalCandleTime = signal.candleTime;
  pairState.lastSignalAt = Date.now();
  pairState.lastSignal = {
    direction: signal.direction,
    entry: signal.entry,
    sl: signal.sl,
    tp1: signal.tp1,
    tp2: signal.tp2,
    tp3: signal.tp3,
    rr: signal.rr,
    score: signal.score,
    probability: signal.probability
  };
}
