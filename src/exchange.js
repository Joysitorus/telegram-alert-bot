export function getMarketMetadata(exchange, symbol) {
  const market = exchange?.markets?.[symbol] || null;
  if (!market) return null;

  const contractSize = Number(market.contractSize ?? market.info?.contractSize ?? market.info?.ctVal ?? 1);
  const contractSizeValid = Number.isFinite(contractSize) && contractSize > 0;
  const precision = market.precision || {};
  const limits = market.limits || {};

  return {
    id: market.id || symbol,
    symbol: market.symbol || symbol,
    base: market.base || null,
    quote: market.quote || null,
    settle: market.settle || market.info?.settleCoin || market.info?.marginCoin || null,
    type: market.type || null,
    spot: Boolean(market.spot),
    margin: Boolean(market.margin),
    swap: Boolean(market.swap),
    future: Boolean(market.future),
    contract: Boolean(market.contract || market.swap || market.future),
    linear: market.linear === undefined ? null : Boolean(market.linear),
    inverse: market.inverse === undefined ? null : Boolean(market.inverse),
    contractSize: contractSizeValid ? contractSize : 1,
    contractSizeValid,
    pricePrecision: precision.price ?? null,
    amountPrecision: precision.amount ?? null,
    minAmount: limits.amount?.min ?? null,
    minCost: limits.cost?.min ?? null,
    raw: market
  };
}

export function getOrderBookLevelNotional(level, marketMetadata = null) {
  const price = Number(level?.[0]);
  const amount = Number(level?.[1]);
  if (!Number.isFinite(price) || !Number.isFinite(amount) || price <= 0 || amount <= 0) return 0;

  const contractSize = Number(marketMetadata?.contractSize) || 1;
  if (marketMetadata?.contract) {
    if (marketMetadata.inverse) return amount * contractSize;
    return price * amount * contractSize;
  }

  return price * amount;
}

export function buildMarketAccuracyReport({ exchange, symbols, marketType }) {
  const errors = [];
  const warnings = [];
  const markets = new Map();
  const wantsContract = marketType === "swap" || marketType === "future";

  for (const symbol of symbols || []) {
    const metadata = getMarketMetadata(exchange, symbol);

    if (!metadata) {
      errors.push(`Symbol ${symbol} tidak ditemukan di exchange ${exchange?.id || "unknown"}.`);
      continue;
    }

    markets.set(symbol, metadata);

    if (marketType === "spot" && metadata.contract) {
      warnings.push(`${symbol} adalah contract market, tetapi MARKET_TYPE=spot.`);
    }

    if (wantsContract && !metadata.contract) {
      errors.push(`${symbol} bukan futures/swap contract market untuk MARKET_TYPE=${marketType}.`);
      continue;
    }

    if (wantsContract && marketType === "swap" && !metadata.swap) {
      warnings.push(`${symbol} tidak ditandai swap oleh CCXT; type=${metadata.type || "-"}.`);
    }

    if (wantsContract && marketType === "future" && !metadata.future) {
      warnings.push(`${symbol} tidak ditandai future oleh CCXT; type=${metadata.type || "-"}.`);
    }

    if (wantsContract && metadata.linear === null && metadata.inverse === null) {
      warnings.push(`${symbol} tidak punya metadata linear/inverse dari CCXT.`);
    }

    if (wantsContract && !metadata.contractSizeValid) {
      errors.push(`${symbol} contractSize tidak valid.`);
    }

    if (wantsContract && !metadata.settle) {
      warnings.push(`${symbol} tidak punya settle/margin coin di metadata CCXT.`);
    }
  }

  return { errors, warnings, markets };
}
