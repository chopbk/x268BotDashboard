export const WARN = {
  "no-monitor": "Chưa có monitor",
  "qty-mismatch": "Lệch qty",
  "closed-on-exchange": "Đã đóng trên sàn, monitor chưa cập nhật",
  "monitor-without-position": "Monitor không thấy vị thế",
  stale: "Dữ liệu cũ",
};

export const CLOSE_PERCENTS = [10, 25, 50, 75, 100];

export function fmt(value, digits = 4) {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function when(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("vi-VN");
}

export function pnlClass(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "";
  return n > 0 ? "term-up" : "term-down";
}

export function numInput(value) {
  if (value == null || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return String(n);
}

export function qtyAtPercent(fullQty, percent) {
  const n = Number(fullQty) * (Number(percent) / 100);
  if (!Number.isFinite(n) || n <= 0) return "";
  return String(Number(n.toPrecision(12)));
}

export function exchangeTpsl(row) {
  return {
    tp: row?.exchangeTp != null ? row.exchangeTp : null,
    sl: row?.exchangeSl != null ? row.exchangeSl : null,
    trailingCallback: row?.exchangeTrailingCallback != null ? row.exchangeTrailingCallback : null,
    trailingActivation: row?.exchangeTrailingActivation != null ? row.exchangeTrailingActivation : null,
    trailingOrderId: row?.exchangeTrailingOrderId || null,
  };
}

export function monitorTpsl(row) {
  const monitors = row?.monitors || [];
  return {
    tp: monitors.map((monitor) => monitor.tp).find(Boolean) || null,
    sl: monitors.map((monitor) => monitor.sl).find(Boolean) || null,
    trailing: monitors.map((monitor) => monitor.trailing).find(Boolean) || null,
  };
}

export function newIdempotencyKey(prefix = "term") {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
