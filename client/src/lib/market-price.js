/**
 * Format giá Market theo tickSize/priceDecimals từ futures_symbols (Mongo).
 * Khớp cách binance-bot roundPrice + Account Static dùng priceDecimals.
 */

export function digitsFromTick(tickSize) {
  const size = Number(tickSize);
  if (!Number.isFinite(size) || size <= 0) return null;
  let scaled = size;
  let decimals = 0;
  while (decimals < 12 && Math.abs(scaled - Math.round(scaled)) > 1e-8) {
    scaled *= 10;
    decimals += 1;
  }
  return decimals;
}

function fallbackDigits(sample, fallback = 2) {
  const amount = Math.abs(Number(sample));
  if (!Number.isFinite(amount) || amount === 0 || amount >= 1) return fallback;
  return Math.min(12, Math.max(fallback, Math.ceil(-Math.log10(amount)) + 2));
}

/**
 * @param {unknown} value
 * @param {{ tickSize?: number|null, priceDecimals?: number|null }|null} symbolInfo
 */
export function fmtMarketPrice(value, symbolInfo = null) {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";

  const tick = Number(symbolInfo?.tickSize);
  let decimals = symbolInfo?.priceDecimals;
  if (!Number.isInteger(decimals) || decimals < 0) {
    decimals = digitsFromTick(tick);
  }

  if (Number.isFinite(tick) && tick > 0 && Number.isInteger(decimals)) {
    const rounded = Math.round(n / tick) * tick;
    // toFixed tránh nhiễu float (vd 1.0000000002)
    return Number(rounded.toFixed(decimals)).toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  const digits = fallbackDigits(n, 2);
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}
