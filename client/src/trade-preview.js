/** Ước tính phí taker USDT-M mặc định (không phải phí VIP thực tế). */
export const TAKER_FEE_RATE = 0.0004;

function n(value) {
  const x = Number(value);
  return Number.isFinite(x) ? x : null;
}

/**
 * Preview đóng / reverse: qty, PnL ước tính tại giá thoát, phí, sibling monitors.
 */
export function closePreview({
  side,
  entry,
  exitPrice,
  qty,
  monitors = [],
  feeRate = TAKER_FEE_RATE,
}) {
  const quantity = Math.abs(n(qty) || 0);
  const entryN = n(entry);
  const exitN = n(exitPrice);
  const sign = side === "SHORT" ? -1 : 1;
  const estimatedPnl = entryN != null && exitN != null && quantity
    ? (exitN - entryN) * quantity * sign
    : null;
  const notional = exitN != null
    ? exitN * quantity
    : (entryN != null ? entryN * quantity : null);
  const estimatedFee = notional != null ? Math.abs(notional) * feeRate : null;
  const siblings = (monitors || []).map((monitor) => ({
    env: monitor.env || "",
    signal: monitor.signal || monitor.type || "",
    ownQty: monitor.ownQty,
    id: monitor.id,
  }));
  return {
    quantity,
    exitPrice: exitN,
    estimatedPnl,
    estimatedFee,
    feeRate,
    netAfterFee: estimatedPnl != null && estimatedFee != null ? estimatedPnl - estimatedFee : null,
    siblings,
    exchangeQtyHint: quantity,
  };
}

export function openPreview({ side, entryOrMark, quantity, feeRate = TAKER_FEE_RATE }) {
  const qty = Math.abs(n(quantity) || 0);
  const px = n(entryOrMark);
  const notional = px != null ? px * qty : null;
  const estimatedFee = notional != null ? Math.abs(notional) * feeRate : null;
  return {
    side,
    quantity: qty,
    price: px,
    notional,
    estimatedFee,
    feeRate,
  };
}
