import { sleep } from "./utils.js";

export async function withRetry(fn, {
  retries = 3,
  delayMs = 1000,
  factor = 2,
  label = "operation"
} = {}) {
  let lastError;
  let waitMs = delayMs;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;

      console.warn(`[RETRY] ${label} gagal attempt=${attempt}/${retries}: ${error.message}`);
      await sleep(waitMs);
      waitMs *= factor;
    }
  }

  throw lastError;
}

export class ErrorThrottler {
  constructor(cooldownMs = 15 * 60 * 1000) {
    this.cooldownMs = cooldownMs;
    this.lastSent = new Map();
  }

  shouldSend(key) {
    const now = Date.now();
    const last = this.lastSent.get(key) || 0;
    if (now - last < this.cooldownMs) return false;

    this.lastSent.set(key, now);
    return true;
  }
}

const levels = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(level = "info") {
  const threshold = levels[level] ?? levels.info;

  function write(logLevel, message, fields = {}) {
    if ((levels[logLevel] ?? levels.info) < threshold) return;
    console.log(JSON.stringify({ time: new Date().toISOString(), level: logLevel, message, ...fields }));
  }

  return {
    debug: (message, fields) => write("debug", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields)
  };
}
