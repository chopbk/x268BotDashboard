export const POSITION_COLUMNS = [
  { id: "account", label: "Tài khoản", text: true },
  { id: "symbol", label: "Symbol", text: true },
  { id: "size", label: "Size" },
  { id: "entry", label: "Entry" },
  { id: "mark", label: "Mark" },
  { id: "unrealized", label: "PnL", title: "Size × (mark − entry)" },
  { id: "recorded", label: "PnL ghi nhận", title: "Lãi đã chốt + fee + funding trên monitor" },
  { id: "liquidation", label: "Liq" },
  { id: "volume", label: "Volume", title: "qty × mark" },
];

export function qtyOf(row) {
  if (row?.exchangeQty != null && row.exchangeQty !== "") {
    const qty = Math.abs(Number(row.exchangeQty));
    return Number.isFinite(qty) ? qty : null;
  }
  const own = (row?.monitors || []).reduce((sum, monitor) => sum + Math.abs(Number(monitor.ownQty) || 0), 0);
  return own > 0 ? own : null;
}

export function volumeOf(row) {
  const qty = qtyOf(row);
  if (qty == null || row?.mark == null) return null;
  const volume = qty * Number(row.mark);
  return Number.isFinite(volume) ? volume : null;
}

export function roiOf(row) {
  const pnl = Number(row?.unrealized);
  const qty = qtyOf(row);
  const entry = Number(row?.entry);
  const leverage = Number(row?.leverage);
  if (!Number.isFinite(pnl) || !qty || !entry || !leverage) return null;
  const margin = Math.abs(qty * entry) / leverage;
  if (!margin) return null;
  return (pnl / margin) * 100;
}

export function sortedRows(rows, key, dir) {
  if (!POSITION_COLUMNS.some((column) => column.id === key)) return rows;
  const sign = dir === "asc" ? 1 : -1;
  const text = POSITION_COLUMNS.find((column) => column.id === key)?.text;
  return [...rows].sort((a, b) => {
    const av = key === "volume" ? volumeOf(a) : key === "size" ? qtyOf(a) : key === "recorded" ? a.recordedNet : a[key];
    const bv = key === "volume" ? volumeOf(b) : key === "size" ? qtyOf(b) : key === "recorded" ? b.recordedNet : b[key];
    const missingA = av == null || av === "";
    const missingB = bv == null || bv === "";
    if (missingA || missingB) {
      if (missingA === missingB) return String(a.symbol).localeCompare(String(b.symbol));
      return missingA ? 1 : -1;
    }
    const compared = text
      ? String(av).localeCompare(String(bv))
      : (Number(av) || 0) - (Number(bv) || 0);
    return compared * sign || String(a.symbol).localeCompare(String(b.symbol)) || String(a.side).localeCompare(String(b.side));
  });
}
