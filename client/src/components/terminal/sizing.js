/**
 * Quy đổi size ticket: Qty | % ví (margin) | USDT notional | rủi ro USDT.
 * Client chỉ ước lượng; server/sàn vẫn làm tròn step và validate.
 */

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export const SIZE_MODES = [
  { id: "qty", label: "Qty" },
  { id: "percent", label: "% ví" },
  { id: "usdt", label: "USDT" },
  { id: "risk", label: "Rủi ro $" },
];

export const OPEN_PERCENTS = [1, 2, 5, 10, 25, 50];

/** Làm tròn xuống theo step (mặc định 1e-8). */
export function floorToStep(value, step = 1e-8) {
  const v = num(value);
  const s = num(step);
  if (v == null || v <= 0 || s == null || s <= 0) return null;
  const units = Math.floor(v / s + 1e-12);
  if (units <= 0) return null;
  return Number((units * s).toPrecision(12));
}

export function qtyFromNotional(notionalUsdt, price, step) {
  const n = num(notionalUsdt);
  const p = num(price);
  if (n == null || n <= 0 || p == null || p <= 0) return null;
  return floorToStep(n / p, step);
}

/**
 * % ví = phần availableBalance dùng làm margin.
 * notional ≈ margin × leverage; qty = notional / price.
 */
export function qtyFromMarginPercent(available, percent, leverage, price, step) {
  const avail = num(available);
  const pct = num(percent);
  const lev = num(leverage) || 1;
  const p = num(price);
  if (avail == null || avail <= 0 || pct == null || pct <= 0 || pct > 100 || p == null || p <= 0) return null;
  const margin = avail * (pct / 100);
  const notional = margin * lev;
  return qtyFromNotional(notional, p, step);
}

/**
 * Risk sizing tuyến tính USD-M (spec Terminal R2).
 * qtyRaw = B / (|E-S| + E*f1 + S*f2)
 */
export function qtyFromRisk({ budget, entry, stop, feeIn = 0, feeOut = 0, step } = {}) {
  const B = num(budget);
  const E = num(entry);
  const S = num(stop);
  const f1 = Math.max(0, num(feeIn) || 0);
  const f2 = Math.max(0, num(feeOut) || 0);
  if (B == null || B <= 0 || E == null || E <= 0 || S == null || S <= 0) return null;
  if (Math.abs(E - S) < 1e-12) return null;
  const denom = Math.abs(E - S) + E * f1 + S * f2;
  if (!(denom > 0)) return null;
  return floorToStep(B / denom, step);
}

export function estimateSize({
  mode = "qty",
  quantity,
  percent,
  usdt,
  riskBudget,
  stop,
  available,
  leverage,
  price,
  feeIn = 0,
  feeOut = 0,
  step = 1e-8,
} = {}) {
  const p = num(price);
  const lev = num(leverage) || 1;
  let qty = null;
  let basis = null;

  if (mode === "qty") {
    qty = floorToStep(quantity, step);
    basis = "qty";
  } else if (mode === "percent") {
    qty = qtyFromMarginPercent(available, percent, lev, p, step);
    basis = "percent";
  } else if (mode === "usdt") {
    qty = qtyFromNotional(usdt, p, step);
    basis = "usdt";
  } else if (mode === "risk") {
    qty = qtyFromRisk({ budget: riskBudget, entry: p, stop, feeIn, feeOut, step });
    basis = "risk";
  }

  const notional = qty != null && p != null ? qty * p : null;
  const margin = notional != null && lev > 0 ? notional / lev : null;
  return {
    mode: basis || mode,
    quantity: qty,
    notional,
    margin,
    leverage: lev,
    price: p,
    ready: qty != null && qty > 0,
  };
}

export function sizeHint(estimate, { available, percent, usdt, riskBudget } = {}) {
  if (!estimate) return "";
  if (estimate.mode === "percent") {
    if (available == null) return "Chưa có availableBalance (Redis wb:bal) — không tính % ví.";
    return `${percent}% ví · margin ≈ ${fmtMoney(estimate.margin)} · notional ≈ ${fmtMoney(estimate.notional)} · qty ${fmtQty(estimate.quantity)}`;
  }
  if (estimate.mode === "usdt") {
    return `USDT ${usdt} → qty ${fmtQty(estimate.quantity)} · notional ≈ ${fmtMoney(estimate.notional)} (không phải margin)`;
  }
  if (estimate.mode === "risk") {
    return `Rủi ro $${riskBudget} → qty ${fmtQty(estimate.quantity)} (ước tính, chưa gồm gap/slippage)`;
  }
  return `Qty ${fmtQty(estimate.quantity)} · notional ≈ ${fmtMoney(estimate.notional)}`;
}

function fmtMoney(value) {
  const n = num(value);
  if (n == null) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function fmtQty(value) {
  const n = num(value);
  if (n == null) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: 8 });
}
