export const POSITION_COLUMNS = [
  { id: "account", label: "Tài khoản", text: true },
  { id: "symbol", label: "Symbol", text: true },
  { id: "size", label: "Size" },
  { id: "entry", label: "Entry" },
  { id: "mark", label: "Mark" },
  { id: "unrealized", label: "PnL" },
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
  const volume = volumeOf(row);
  const leverage = Number(row?.leverage);
  if (!Number.isFinite(pnl) || !volume || !leverage) return null;
  return (pnl * leverage / volume) * 100;
}

export function sortedRows(rows, key, dir) {
  if (!POSITION_COLUMNS.some((column) => column.id === key)) return rows;
  const sign = dir === "asc" ? 1 : -1;
  const text = POSITION_COLUMNS.find((column) => column.id === key)?.text;
  return [...rows].sort((a, b) => {
    const av = key === "volume" ? volumeOf(a) : key === "size" ? qtyOf(a) : a[key];
    const bv = key === "volume" ? volumeOf(b) : key === "size" ? qtyOf(b) : b[key];
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
