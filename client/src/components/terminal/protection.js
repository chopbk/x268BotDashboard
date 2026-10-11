import { exchangeTpsl, monitorTpsl, fmt } from "./format.js";

/**
 * Nhãn bảo vệ theo spec Terminal R1.
 * ordersVerified: true khi case/orders đã đối chiếu đầy đủ; false/null khi chưa xác minh.
 */
export function protectionStatus(row, { ordersVerified = null, stale = false, ordersError = false } = {}) {
  const exchange = exchangeTpsl(row);
  const monitor = monitorTpsl(row);
  const unverified = stale || ordersError || ordersVerified === false;

  let sl;
  if (unverified && exchange.sl == null) {
    sl = { kind: "unverified", label: "Chưa xác minh", detail: "Sổ lệnh chưa đối chiếu đủ hoặc dữ liệu cũ" };
  } else if (exchange.sl != null) {
    sl = { kind: "exchange", label: "SL sàn", detail: fmt(exchange.sl), price: exchange.sl };
  } else if (monitor.sl) {
    sl = { kind: "monitor", label: "Bot theo dõi", detail: String(monitor.sl) };
  } else if (ordersVerified === true) {
    sl = { kind: "missing", label: "Chưa có SL sàn", detail: "Đã đối chiếu, không thấy SL phù hợp" };
  } else {
    sl = { kind: "unverified", label: "Chưa xác minh", detail: "Chưa tải đủ orders" };
  }

  let tp;
  if (exchange.tp != null) {
    tp = { kind: "exchange", label: "TP sàn", detail: fmt(exchange.tp), price: exchange.tp };
  } else if (monitor.tp) {
    tp = { kind: "monitor", label: "TP monitor", detail: String(monitor.tp) };
  } else if (unverified) {
    tp = { kind: "unverified", label: "TP · chưa xác minh", detail: "" };
  } else {
    tp = { kind: "missing", label: "Chưa thấy TP", detail: "" };
  }

  let trailing = null;
  if (exchange.trailingCallback != null) {
    trailing = {
      kind: "exchange",
      label: `Trail ${fmt(exchange.trailingCallback, 2)}%`,
      callback: exchange.trailingCallback,
      activation: exchange.trailingActivation,
    };
  } else if (monitor.trailing) {
    trailing = { kind: "monitor", label: `Trail monitor ${monitor.trailing}`, callback: monitor.trailing };
  }

  return { sl, tp, trailing, exchange, monitor };
}

export function protectionShortText(status) {
  if (!status) return "—";
  const parts = [`${status.sl.label}${status.sl.detail ? ` ${status.sl.detail}` : ""}`, `${status.tp.label}${status.tp.detail ? ` ${status.tp.detail}` : ""}`];
  if (status.trailing) parts.push(status.trailing.label);
  return parts.join(" · ");
}

export function needsAttention(row, { stale = false } = {}) {
  if ((row.warnings || []).length) return true;
  if (row.notpsl) return true;
  if (row.book === "pending") return true;
  if (stale) return true;
  const status = protectionStatus(row, { stale, ordersVerified: null });
  if (status.sl.kind === "missing" || status.sl.kind === "unverified") return true;
  const monitors = row.monitors || [];
  if (monitors.length && monitors.every((m) => !m.watching)) return true;
  return false;
}
