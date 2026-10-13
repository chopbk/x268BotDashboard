import { closePreview } from "../../trade-preview.js";
import { qtyOf } from "../../position-sort.js";

/**
 * Vị thế live trong bộ lọc hiện tại (bỏ paper/pending).
 * percent áp dụng riêng từng dòng — vd 50% → mỗi vị thế đóng 50% size.
 */
export function closableRows(rows = []) {
  return (rows || []).filter((row) => row && row.book !== "paper" && row.book !== "pending");
}

export function buildCloseAllItems(rows = [], percent = 100) {
  const pct = Number(percent);
  const usePct = Number.isFinite(pct) && pct > 0 && pct <= 100 ? pct : 100;
  return closableRows(rows).map((row) => {
    const fullQty = qtyOf(row);
    const closeQty = !Number.isFinite(fullQty)
      ? null
      : usePct === 100
        ? fullQty
        : fullQty * (usePct / 100);
    const preview = closePreview({
      side: row.side,
      entry: row.entry,
      exitPrice: row.mark,
      qty: closeQty,
      monitors: row.monitors,
    });
    return {
      key: row.key,
      account: row.account,
      symbol: row.symbol,
      side: row.side,
      entry: row.entry,
      mark: row.mark,
      fullQty,
      closeQty,
      monitors: row.monitors || [],
      preview,
    };
  });
}

export function summarizeCloseAll(items = []) {
  let estimatedPnl = 0;
  let estimatedFee = 0;
  let pnlOk = 0;
  let feeOk = 0;
  for (const item of items) {
    if (item.preview?.estimatedPnl != null) {
      estimatedPnl += item.preview.estimatedPnl;
      pnlOk += 1;
    }
    if (item.preview?.estimatedFee != null) {
      estimatedFee += item.preview.estimatedFee;
      feeOk += 1;
    }
  }
  return {
    count: items.length,
    estimatedPnl: pnlOk ? estimatedPnl : null,
    estimatedFee: feeOk ? estimatedFee : null,
    netAfterFee: pnlOk && feeOk ? estimatedPnl - estimatedFee : null,
  };
}
