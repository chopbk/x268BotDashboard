import { fmt, pnlClass } from "./format.js";

export default function TerminalSummary({ summary, bookLabel }) {
  if (!summary) return null;
  const primary = summary.groups[summary.primary] || summary.groups.live;
  const split = summary.groups.live.count && summary.groups.paper.count;

  return (
    <div className="term-summary" aria-label="Tóm tắt bộ lọc">
      <div className="term-summary-card">
        <span className="term-summary-label">PnL đang mở</span>
        <strong className={pnlClass(primary.unrealized)}>{fmt(primary.unrealized, 2)} USDT</strong>
        <span className="muted">{bookLabel || summary.primary}</span>
      </div>
      <div className="term-summary-card">
        <span className="term-summary-label">Giá trị vị thế</span>
        <strong>{fmt(primary.notional, 2)} USDT</strong>
        <span className="muted">|notional|</span>
      </div>
      <div className="term-summary-card">
        <span className="term-summary-label">Vị thế đang mở</span>
        <strong>{summary.total}</strong>
        <span className="muted">theo bộ lọc</span>
      </div>
      <div className="term-summary-card">
        <span className="term-summary-label">Cần chú ý</span>
        <strong className={summary.attention ? "term-warn-text" : ""}>{summary.attention}</strong>
        <span className="muted">cảnh báo / thiếu SL</span>
      </div>
      {split ? (
        <p className="term-summary-split muted">
          Live: PnL {fmt(summary.groups.live.unrealized, 2)} · {summary.groups.live.count} vị thế
          {" · "}Paper: PnL {fmt(summary.groups.paper.unrealized, 2)} · {summary.groups.paper.count} vị thế
          {" — không cộng gộp hai sổ."}
        </p>
      ) : null}
      {summary.missingPnl || summary.missingNotional ? (
        <p className="term-summary-coverage muted">
          Coverage: thiếu PnL {summary.missingPnl}, thiếu notional {summary.missingNotional}.
        </p>
      ) : null}
    </div>
  );
}
