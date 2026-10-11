import { exchangeTpsl, monitorTpsl, fmt } from "./format.js";

/**
 * Nhãn bảo vệ Terminal — ưu tiên mức sàn, rồi monitor; chỉ “chưa xác minh” khi stale/lỗi và không có mức nào.
 */
export function protectionStatus(row, { ordersVerified = null, stale = false, ordersError = false } = {}) {
  const exchange = exchangeTpsl(row);
  const monitor = monitorTpsl(row);
  const sourceBroken = stale || ordersError;

  let sl;
  if (exchange.sl != null) {
    sl = { kind: "exchange", label: "SL", detail: fmt(exchange.sl), price: exchange.sl };
  } else if (monitor.sl) {
    sl = { kind: "monitor", label: "SL bot", detail: String(monitor.sl), price: Number(monitor.sl) || null };
  } else if (sourceBroken) {
    sl = { kind: "unverified", label: "SL ?", detail: "Chưa xác minh", price: null };
  } else if (ordersVerified === true) {
    sl = { kind: "missing", label: "SL —", detail: "Chưa có SL sàn", price: null };
  } else if ((row.monitors || []).length) {
    sl = { kind: "missing", label: "SL —", detail: "Chưa thấy SL sàn", price: null };
  } else {
    sl = { kind: "missing", label: "SL —", detail: "Chưa thấy trên sổ", price: null };
  }

  let tp;
  if (exchange.tp != null) {
    tp = { kind: "exchange", label: "TP", detail: fmt(exchange.tp), price: exchange.tp };
  } else if (monitor.tp) {
    tp = { kind: "monitor", label: "TP bot", detail: String(monitor.tp), price: Number(monitor.tp) || null };
  } else if (sourceBroken && exchange.sl == null && !monitor.sl) {
    tp = { kind: "unverified", label: "TP ?", detail: "Chưa xác minh", price: null };
  } else {
    tp = { kind: "missing", label: "TP —", detail: "", price: null };
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
    trailing = { kind: "monitor", label: `Trail ${monitor.trailing}`, callback: monitor.trailing };
  }

  return { sl, tp, trailing, exchange, monitor };
}

/** Hai dòng giống Entry/Mark: TP trên, SL dưới. */
export function protectionCellText(status) {
  if (!status) return { tpLine: "—", slLine: "—", note: "" };
  const tpLine = status.tp.detail
    ? `${status.tp.label} ${status.tp.detail}`
    : status.tp.label;
  const slLine = status.sl.price != null || (status.sl.detail && status.sl.detail !== "Chưa xác minh" && !String(status.sl.detail).startsWith("Chưa"))
    ? `${status.sl.label} ${status.sl.detail}`
    : status.sl.label;
  const note = status.trailing
    ? status.trailing.label
    : (status.sl.kind === "monitor" || status.tp.kind === "monitor" ? "monitor" : "");
  return { tpLine, slLine, note, primary: `${tpLine} / ${slLine}`, secondary: note };
}

export function protectionShortText(status) {
  if (!status) return "—";
  const { tpLine, slLine, note } = protectionCellText(status);
  return note ? `${tpLine} · ${slLine} · ${note}` : `${tpLine} · ${slLine}`;
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
