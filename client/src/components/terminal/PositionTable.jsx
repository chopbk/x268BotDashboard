import { Fragment, useState } from "react";
import { qtyOf, roiOf, volumeOf } from "../../position-sort";
import { WARN, fmt, when, pnlClass } from "./format.js";
import { protectionStatus, protectionShortText, protectionCellText, needsAttention } from "./protection.js";
import { ownershipView } from "./summary.js";

const SORTABLE = [
  { id: "symbol", label: "Symbol", text: true },
  { id: "account", label: "Tài khoản", text: true },
  { id: "volume", label: "Volume" },
  { id: "size", label: "Size" },
  { id: "entry", label: "Entry" },
  { id: "unrealized", label: "PnL" },
  { id: "recorded", label: "PnL ghi nhận" },
  { id: "liquidation", label: "Liq" },
];

export default function PositionTable({
  rows,
  sort,
  onSort,
  selectedKey,
  expanded,
  columns,
  density,
  stale,
  canClose,
  canOpen,
  canTpsl,
  onSelect,
  onToggleExpand,
  onClose,
  onTpsl,
  onMenu,
}) {
  return (
    <div className={`term-table-wrap density-${density || "compact"}`}>
      <table className="term-table">
        <thead>
          <tr>
            <th className="term-col-expand" />
            {columns.symbol !== false ? (
              <th aria-sort={ariaSort(sort, "symbol")}>
                <button type="button" className="term-sort" onClick={() => onSort("symbol")}>Symbol/Side{sortMark(sort, "symbol")}</button>
              </th>
            ) : null}
            {columns.account !== false ? (
              <th aria-sort={ariaSort(sort, "account")}>
                <button type="button" className="term-sort" onClick={() => onSort("account")}>Tài khoản{sortMark(sort, "account")}</button>
              </th>
            ) : null}
            {columns.config ? <th>Config/Signal</th> : null}
            {columns.volume !== false ? (
              <th aria-sort={ariaSort(sort, "volume")}>
                <button type="button" className="term-sort" title="qty × mark (USDT)" onClick={() => onSort("volume")}>Volume{sortMark(sort, "volume")}</button>
              </th>
            ) : null}
            {columns.size ? (
              <th aria-sort={ariaSort(sort, "size")}>
                <button type="button" className="term-sort" onClick={() => onSort("size")}>Size{sortMark(sort, "size")}</button>
              </th>
            ) : null}
            {columns.entryMark !== false ? (
              <th aria-sort={ariaSort(sort, "entry")}>
                <button type="button" className="term-sort" onClick={() => onSort("entry")}>Entry/Mark{sortMark(sort, "entry")}</button>
              </th>
            ) : null}
            {columns.pnl !== false ? (
              <th aria-sort={ariaSort(sort, "unrealized")}>
                <button type="button" className="term-sort" onClick={() => onSort("unrealized")}>PnL/ROI{sortMark(sort, "unrealized")}</button>
              </th>
            ) : null}
            {columns.recorded ? (
              <th aria-sort={ariaSort(sort, "recorded")}>
                <button type="button" className="term-sort" onClick={() => onSort("recorded")}>PnL ghi nhận{sortMark(sort, "recorded")}</button>
              </th>
            ) : null}
            {columns.liquidation ? (
              <th aria-sort={ariaSort(sort, "liquidation")}>
                <button type="button" className="term-sort" onClick={() => onSort("liquidation")}>Thanh lý{sortMark(sort, "liquidation")}</button>
              </th>
            ) : null}
            {columns.protection !== false ? <th>Bảo vệ</th> : null}
            {columns.dataAge ? <th>Tuổi DL</th> : null}
            {columns.actions !== false ? <th className="term-col-actions">Thao tác</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <PositionRow
              key={row.key}
              row={row}
              selected={selectedKey === row.key}
              expanded={expanded.has(row.key)}
              columns={columns}
              stale={stale}
              canClose={canClose}
              canOpen={canOpen}
              canTpsl={canTpsl}
              onSelect={onSelect}
              onToggleExpand={onToggleExpand}
              onClose={onClose}
              onTpsl={onTpsl}
              onMenu={onMenu}
            />
          ))}
        </tbody>
      </table>
      {/* Mobile cards */}
      <div className="term-card-list">
        {rows.map((row) => (
          <PositionCard
            key={`card-${row.key}`}
            row={row}
            selected={selectedKey === row.key}
            stale={stale}
            canClose={canClose}
            canTpsl={canTpsl}
            onSelect={onSelect}
            onClose={onClose}
            onTpsl={onTpsl}
            onMenu={onMenu}
          />
        ))}
      </div>
    </div>
  );
}

function PositionRow({
  row, selected, expanded, columns, stale, canClose, canOpen, canTpsl,
  onSelect, onToggleExpand, onClose, onTpsl, onMenu,
}) {
  const roi = roiOf(row);
  const status = protectionStatus(row, { stale });
  const own = ownershipView(row);
  const attention = needsAttention(row, { stale });
  const monitors = row.monitors || [];
  const signals = monitors.map((m) => m.signal || m.type).filter(Boolean).join(", ");
  const configs = [...new Set(monitors.map((m) => m.env).filter(Boolean))];
  const configText = configs.join(", ");
  const otherWarns = (row.warnings || []).filter((w) => w !== "no-monitor");

  return (
    <Fragment>
      <tr
        className={[selected ? "term-row-selected" : "", attention ? "term-row-attention" : ""].filter(Boolean).join(" ")}
        data-row={row.key}
        tabIndex={0}
        onClick={() => onSelect(row.key)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSelect(row.key);
        }}
      >
        <td className="term-col-expand">
          <button type="button" className="ghost" aria-label="Mở rộng monitor" onClick={(e) => { e.stopPropagation(); onToggleExpand(row.key); }}>
            {expanded ? "−" : "+"}
          </button>
        </td>
        {columns.symbol !== false ? (
          <td>
            <div className="term-symbol-cell">
              <strong>{row.symbol}</strong>
              <span className={`term-side term-side-${String(row.side).toLowerCase()}`}>{row.side}</span>
              {row.leverage != null ? <span className="muted">{fmt(row.leverage, 0)}x</span> : null}
              {row.book === "paper" ? <span className="term-badge">Paper</span> : null}
              {row.book === "pending" ? <span className="term-badge">Lệnh chờ</span> : null}
              {row.notpsl ? <span className="term-badge term-badge-warn">NOTPSL</span> : null}
            </div>
          </td>
        ) : null}
        {columns.account !== false ? (
          <td className="term-account-cell" title={[row.account, configText, signals].filter(Boolean).join(" · ")}>
            <span className="term-account-name">{row.account}</span>
            {monitors.length ? (
              <>
                <span className="term-account-meta">
                  Monitor{monitors.length > 1 ? ` ×${monitors.length}` : ""}
                  {configText ? ` · ${configText}` : ""}
                </span>
                {signals ? <span className="term-account-meta term-ellip">{signals}</span> : null}
              </>
            ) : (
              <span className="term-mini-warn">Chưa monitor</span>
            )}
            {otherWarns.length ? (
              <span className="term-mini-warn">{otherWarns.map((w) => WARN[w] || w).join(" · ")}</span>
            ) : null}
          </td>
        ) : null}
        {columns.config ? <td className="muted term-ellip" title={`${configText} / ${signals}`}>{configText || "—"}{signals ? ` · ${signals}` : ""}</td> : null}
        {columns.volume !== false ? (
          <td className="term-num" title={`Volume = qty × mark${own.size != null ? ` · qty ${fmt(own.size)}` : ""}`}>
            {volumeOf(row) == null ? "—" : fmt(volumeOf(row), 2)}
            {own.allocation === "over" ? <span className="term-warn-text"> !</span> : null}
          </td>
        ) : null}
        {columns.size ? (
          <td className="term-num" title={own.allocation === "over" ? "Lệch phân bổ: ownQty > sàn" : own.allocation === "under" ? "Còn qty chưa gán monitor" : ""}>
            {own.size == null ? "—" : fmt(own.size)}
          </td>
        ) : null}
        {columns.entryMark !== false ? (
          <td className="term-num term-dual">
            <span>{fmt(row.entry)}</span>
            <span className="muted">{fmt(row.mark)}</span>
          </td>
        ) : null}
        {columns.pnl !== false ? (
          <td className={`term-num ${pnlClass(row.unrealized)}`} title="PnL toàn vị thế sàn">
            <span>{row.unrealized == null ? "—" : fmt(row.unrealized, 2)}</span>
            {roi == null ? null : <span className="muted">{roi > 0 ? "+" : ""}{fmt(roi, 2)}%</span>}
          </td>
        ) : null}
        {columns.recorded ? <td className={`term-num ${pnlClass(row.recorded?.net)}`}>{row.recorded ? fmt(row.recorded.net, 2) : "—"}</td> : null}
        {columns.liquidation ? <td className="term-num">{fmt(row.liquidation)}</td> : null}
        {columns.protection !== false ? (() => {
          const cell = protectionCellText(status);
          return (
            <td className={`term-num term-dual term-protect term-protect-${status.sl.kind}`} title={protectionShortText(status)}>
              <span className="term-protect-tp">{cell.tpLine}</span>
              <span className="term-protect-sl muted">{cell.slLine}</span>
            </td>
          );
        })() : null}
        {columns.dataAge ? <td className="muted">{when(row.updatedAt || row.checkedAt)}</td> : null}
        {columns.actions !== false ? (
          <td className="term-col-actions" onClick={(e) => e.stopPropagation()}>
            <div className="term-row-actions">
              <button type="button" disabled={!canClose || row.book === "paper" || row.book === "pending"} onClick={() => onClose(row)}>Đóng</button>
              <button type="button" disabled={!canTpsl || row.book === "paper" || row.book === "pending"} onClick={() => onTpsl(row)}>TP/SL</button>
              <RowMenu row={row} canOpen={canOpen} canClose={canClose} onMenu={onMenu} />
            </div>
          </td>
        ) : null}
      </tr>
      {expanded ? monitors.map((monitor) => (
        <tr key={monitor.id} className="term-child">
          <td />
          <td colSpan={12}>
            <button type="button" className="linkish" onClick={() => onSelect(row.key, { monitorId: monitor.id, panelTab: "monitor" })}>
              {monitor.env || "config"}
            </button>
            {" · "}{monitor.signal || monitor.type || "—"}
            {" · qty riêng "}{fmt(monitor.ownQty)}
            {" · sàn snapshot "}{fmt(monitor.exchangeSnapshotQty)}
            {" · SL "}{monitor.sl || "—"} · TP {monitor.tp || "—"}
            {" · HP "}{monitor.hp || "—"}
            {" · "}{monitor.watching ? "Đang theo dõi" : "Không heartbeat"}
            {" · mở "}{when(monitor.openedAt)}
          </td>
        </tr>
      )) : null}
    </Fragment>
  );
}

function PositionCard({ row, selected, stale, canClose, canTpsl, onSelect, onClose, onTpsl, onMenu }) {
  const status = protectionStatus(row, { stale });
  const roi = roiOf(row);
  return (
    <article className={`term-card ${selected ? "term-row-selected" : ""}`} onClick={() => onSelect(row.key)}>
      <header>
        <strong>{row.symbol}</strong>
        <span className={`term-side term-side-${String(row.side).toLowerCase()}`}>{row.side}</span>
        <span className="muted">
          {row.account}
          {(row.monitors || []).length
            ? ` · Monitor · ${[...new Set((row.monitors || []).map((m) => m.env).filter(Boolean))].join(", ") || "—"}`
            : " · Chưa monitor"}
        </span>
      </header>
      <div className="term-card-grid">
        <span>Vol <b className="term-num">{volumeOf(row) == null ? "—" : fmt(volumeOf(row), 2)}</b></span>
        <span className={pnlClass(row.unrealized)}>PnL <b>{row.unrealized == null ? "—" : fmt(row.unrealized, 2)}</b>{roi != null ? ` (${fmt(roi, 1)}%)` : ""}</span>
        <span className="muted">{fmt(row.entry)} → {fmt(row.mark)}</span>
        <span className={`term-dual term-protect-${status.sl.kind}`}>
          <span>{protectionCellText(status).tpLine}</span>
          <span className="muted">{protectionCellText(status).slLine}</span>
        </span>
      </div>
      <div className="term-row-actions" onClick={(e) => e.stopPropagation()}>
        <button type="button" disabled={!canClose || row.book === "paper" || row.book === "pending"} onClick={() => onClose(row)}>Đóng</button>
        <button type="button" disabled={!canTpsl || row.book === "paper" || row.book === "pending"} onClick={() => onTpsl(row)}>TP/SL</button>
        <RowMenu row={row} canOpen onMenu={onMenu} />
      </div>
    </article>
  );
}

function RowMenu({ row, canOpen, canClose, onMenu }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="term-menu">
      <button type="button" className="ghost" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>...</button>
      {open ? (
        <div className="term-menu-pop" role="menu">
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onMenu(row, "reverse"); }}>Đảo chiều</button>
          <button type="button" role="menuitem" disabled={!canOpen} onClick={() => { setOpen(false); onMenu(row, "add-monitor"); }}>Thêm monitor</button>
          {(row.monitors || []).map((m) => (
            <button key={m.id} type="button" role="menuitem" disabled={!canClose} onClick={() => { setOpen(false); onMenu(row, "remove-monitor", m); }}>
              Xóa monitor {m.env} {m.signal || ""}
            </button>
          ))}
          <button type="button" role="menuitem" onClick={() => { setOpen(false); onMenu(row, "detail"); }}>Mở chi tiết</button>
        </div>
      ) : null}
    </span>
  );
}

function ariaSort(sort, id) {
  if (sort.key !== id) return "none";
  return sort.dir === "asc" ? "ascending" : "descending";
}

function sortMark(sort, id) {
  if (sort.key !== id) return "";
  return sort.dir === "asc" ? " ↑" : " ↓";
}

export { SORTABLE };
