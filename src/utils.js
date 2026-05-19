export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function timeframeToMs(timeframe) {
  const match = String(timeframe).trim().match(/^(\d+)(m|h|d|w|M)$/);
  if (!match) {
    throw new Error(`Unsupported timeframe: ${timeframe}`);
  }

  const value = Number(match[1]);
  const unit = match[2];

  const multipliers = {
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    M: 30 * 24 * 60 * 60 * 1000
  };

  return value * multipliers[unit];
}

export function formatDateTime(timestamp) {
  if (!timestamp || !Number.isFinite(Number(timestamp))) return "-";
  return new Date(Number(timestamp)).toISOString().replace("T", " ").replace(".000Z", " UTC");
}

export function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["true", "1", "yes", "y", "on"].includes(String(value).trim().toLowerCase());
}

export function toNumber(value, fallback, { min = -Infinity, max = Infinity } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export function parseCsv(value, fallback = []) {
  if (!value) return fallback;
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseJson(value, fallback = {}) {
  if (!value) return fallback;

  try {
    return JSON.parse(value);
  } catch (error) {
    console.warn(`Gagal parse JSON env: ${error.message}`);
    return fallback;
  }
}

export function formatPrice(value, decimals = 12) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "-";

  const num = Number(value);
  if (num === 0) return "0";

  const fixed = num.toFixed(decimals);
  return fixed.replace(/\.?0+$/, "");
}

export function formatNumber(value, decimals = 2) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "-";
  return Number(value).toFixed(decimals).replace(/\.?0+$/, "");
}

export function escapeHtml(text = "") {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function safeJsonString(value) {
  return String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\"')
    .replaceAll("\n", " ");
}
