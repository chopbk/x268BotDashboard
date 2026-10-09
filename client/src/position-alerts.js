const QTY_EPS = 1e-8;

function rowId(row) {
  return `${row.account}|${row.symbol}|${row.side}|${row.book || "live"}`;
}

function liveRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => (row.book || "live") === "live" && row.symbol && row.side);
}

export function positionAlerts(previous, next) {
  if (!previous?.rows || !next?.rows) return [];
  const before = new Map(liveRows(previous.rows).map((row) => [rowId(row), row]));
  const after = new Map(liveRows(next.rows).map((row) => [rowId(row), row]));
  if (!before.size && !after.size) return [];
  const alerts = [];
  for (const [key, row] of before) {
    if (after.has(key)) continue;
    alerts.push({
      id: `close-${key}-${next.sources?.find((item) => item.account === row.account)?.version ?? Date.now()}`,
      kind: "close",
      account: row.account,
      symbol: row.symbol,
      side: row.side,
      qty: row.exchangeQty,
    });
  }
  for (const [key, row] of after) {
    const old = before.get(key);
    if (!old) {
      alerts.push({
        id: `open-${key}-${next.sources?.find((item) => item.account === row.account)?.version ?? Date.now()}`,
        kind: "open",
        account: row.account,
        symbol: row.symbol,
        side: row.side,
        qty: row.exchangeQty,
      });
      continue;
    }
    const from = Number(old.exchangeQty);
    const to = Number(row.exchangeQty);
    if (!Number.isFinite(from) || !Number.isFinite(to) || Math.abs(from - to) <= QTY_EPS) continue;
    alerts.push({
      id: `size-${key}-${to}`,
      kind: "size",
      account: row.account,
      symbol: row.symbol,
      side: row.side,
      from,
      to,
    });
  }
  return alerts;
}

export function alertText(alert) {
  const head = `${alert.account} · ${alert.symbol} ${alert.side}`;
  if (alert.kind === "close") return `${head} đã đóng`;
  if (alert.kind === "open") return `${head} vừa mở${alert.qty == null ? "" : ` · ${alert.qty}`}`;
  return `${head} đổi size ${alert.from} → ${alert.to}`;
}
