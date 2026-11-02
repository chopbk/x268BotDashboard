/** Định dạng hiển thị chart — không dùng để tính toán. */

export function finite(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function money(value, digits = 2) {
  const n = finite(value);
  if (n == null) return "—";
  const text = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  if (n > 0) return `+${text} USDT`;
  if (n < 0) return `−${text} USDT`;
  return `${text} USDT`;
}

export function moneyShort(value, digits = 2) {
  const n = finite(value);
  if (n == null) return "—";
  const text = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  if (n > 0) return `+${text}$`;
  if (n < 0) return `−${text}$`;
  return `${text}$`;
}

export function compact(value) {
  const n = finite(value);
  if (n == null) return "—";
  const abs = Math.abs(n);
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}k`;
  return `${sign}${abs.toFixed(abs >= 10 ? 0 : 1)}`;
}

export function pct(value, digits = 1) {
  const n = finite(value);
  if (n == null) return "—";
  return `${n.toFixed(digits)}%`;
}

export function toneClass(value) {
  const n = finite(value);
  if (n == null || n === 0) return "dv-zero";
  return n > 0 ? "dv-pos" : "dv-neg";
}

export function pnlSign(value) {
  const n = finite(value);
  if (n == null || n === 0) return "0";
  return n > 0 ? "+" : "−";
}
