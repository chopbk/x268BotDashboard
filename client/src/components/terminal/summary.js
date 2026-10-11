import { qtyOf, volumeOf } from "../../position-sort.js";
import { needsAttention } from "./protection.js";

/**
 * Summary trên toàn bộ kết quả khớp filter (không chỉ trang).
 * Live/Paper tách nhóm; không cộng ROI %.
 */
export function buildSummary(rows, { stale = false } = {}) {
  const groups = { live: emptyGroup(), paper: emptyGroup(), pending: emptyGroup() };
  let attention = 0;
  let missingPnl = 0;
  let missingNotional = 0;

  for (const row of rows) {
    const book = row.book === "paper" ? "paper" : row.book === "pending" ? "pending" : "live";
    const g = groups[book];
    g.count += 1;
    const pnl = Number(row.unrealized);
    if (Number.isFinite(pnl)) g.unrealized += pnl;
    else missingPnl += 1;
    const vol = volumeOf(row);
    if (vol != null) g.notional += Math.abs(vol);
    else missingNotional += 1;
    if (needsAttention(row, { stale })) attention += 1;
  }

  return {
    total: rows.length,
    attention,
    missingPnl,
    missingNotional,
    groups,
    primary: pickPrimary(groups),
  };
}

function emptyGroup() {
  return { count: 0, unrealized: 0, notional: 0 };
}

function pickPrimary(groups) {
  if (groups.live.count) return "live";
  if (groups.paper.count) return "paper";
  if (groups.pending.count) return "pending";
  return "live";
}

export function ownershipView(row) {
  const exchangeQty = row?.exchangeQty != null ? Math.abs(Number(row.exchangeQty)) : null;
  const monitors = row?.monitors || [];
  const ownTotal = monitors.reduce((sum, m) => sum + Math.abs(Number(m.ownQty) || 0), 0);
  let allocation = "ok";
  if (exchangeQty != null && Number.isFinite(exchangeQty)) {
    if (ownTotal > exchangeQty + 1e-8) allocation = "over";
    else if (ownTotal + 1e-8 < exchangeQty && monitors.length) allocation = "under";
    else if (!monitors.length && exchangeQty > 0) allocation = "unassigned";
  }
  return {
    exchangeQty: Number.isFinite(exchangeQty) ? exchangeQty : null,
    ownTotal,
    leftover: exchangeQty != null && Number.isFinite(exchangeQty) ? Math.max(0, exchangeQty - ownTotal) : null,
    allocation,
    size: qtyOf(row),
  };
}
