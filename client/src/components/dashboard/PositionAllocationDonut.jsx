import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { coinSlices, sideSlices, donutArcs } from "./allocationSlices.js";
import "./dashboard-panels.css";

function money(value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  return `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(Number(value))} USDT`;
}

function pct(value, total) {
  if (!(total > 0) || value == null) return "—";
  return `${Math.round((Number(value) / total) * 1000) / 10}%`;
}

export default function PositionAllocationDonut({ allocation }) {
  const [mode, setMode] = useState("coin"); // coin | side
  const [selected, setSelected] = useState(null);
  const [tip, setTip] = useState(null);

  const pack = useMemo(() => {
    if (!allocation || allocation.quality === "unavailable") return null;
    if (mode === "side") return sideSlices(allocation.bySide);
    return coinSlices(allocation.bySymbol, { limit: 5 });
  }, [allocation, mode]);

  const arcs = useMemo(
    () => donutArcs(pack?.slices || [], { size: 240, thickness: 32 }),
    [pack]
  );

  if (allocation == null) return null;

  const coverage = allocation.coverage || {};
  const gross = allocation.gross;
  const emptyPositions =
    allocation.quality !== "unavailable"
    && coverage.positionsIncluded === 0
    && coverage.accountsAvailable > 0;

  function rowsForSelection() {
    const all = Array.isArray(allocation.rows) ? allocation.rows : [];
    if (!selected) return all;
    if (selected === "__other__") {
      const slice = (pack?.slices || []).find((row) => row.key === "__other__");
      const keys = new Set(slice?.otherKeys || []);
      return all.filter((row) => keys.has(row.symbol) || keys.has(row.instrumentId));
    }
    if (selected === "LONG" || selected === "SHORT") {
      return all.filter((row) => row.side === selected);
    }
    return all.filter((row) => row.symbol === selected || row.instrumentId === selected);
  }

  const detailRows = rowsForSelection();

  return (
    <section className="card dash-panel" aria-labelledby="dash-alloc-title">
      <div className="dash-health-head">
        <div>
          <h2 id="dash-alloc-title">Phân bổ vị thế</h2>
          <p className="muted dash-panel-sub">
            Giá trị vị thế · gross notional USDT · sổ Redis trong scope · không phải ký quỹ
          </p>
        </div>
        <Link className="ghost link-btn" to="/terminal">Mở Terminal</Link>
      </div>

      <div className="dv-mode-tabs" role="tablist" aria-label="Chế độ phân bổ">
        <button type="button" role="tab" aria-selected={mode === "coin"} className={mode === "coin" ? "active" : "ghost"} onClick={() => { setMode("coin"); setSelected(null); }}>
          Theo coin
        </button>
        <button type="button" role="tab" aria-selected={mode === "side"} className={mode === "side" ? "active" : "ghost"} onClick={() => { setMode("side"); setSelected(null); }}>
          Long–Short
        </button>
      </div>

      {allocation.quality === "unavailable" ? (
        <p className="muted">
          Chưa có dữ liệu vị thế.{" "}
          <Link to="/terminal">Mở Terminal</Link> để đồng bộ sổ — dashboard không gọi REST sàn.
        </p>
      ) : emptyPositions ? (
        <p className="muted">Không có vị thế mở trong sổ đã có.</p>
      ) : (
        <>
          {allocation.quality === "partial" ? (
            <p className="muted dash-panel-note">
              Tỷ trọng trong dữ liệu đã có
              {coverage.accountsAvailable < coverage.accountsExpected
                ? ` · sổ ${coverage.accountsAvailable}/${coverage.accountsExpected} account`
                : ""}
              {coverage.positionsExcluded
                ? ` · loại ${coverage.positionsExcluded} vị thế thiếu mark/side/multiplier`
                : ""}
              {allocation.stale ? " · sổ cũ" : ""}.
            </p>
          ) : allocation.stale ? (
            <p className="muted dash-panel-note">Sổ đối chiếu cũ — tỷ trọng vẫn theo snapshot hiện có.</p>
          ) : null}

          <div className="dash-alloc-layout">
            <div className="dash-donut-wrap">
              <svg
                className="dash-donut"
                viewBox="0 0 240 240"
                width="240"
                height="240"
                role="img"
                aria-label={`Phân bổ ${mode === "side" ? "Long Short" : "theo coin"}, tổng ${money(gross)}`}
              >
                {arcs.paths.map((path) => (
                  <path
                    key={path.key}
                    d={path.d}
                    fill={path.color}
                    className={`dash-donut-slice${selected === path.key ? " is-active" : ""}`}
                    tabIndex={0}
                    role="button"
                    aria-label={`${path.label} ${money(path.value)} (${path.share}%)`}
                    onClick={() => setSelected((prev) => (prev === path.key ? null : path.key))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelected((prev) => (prev === path.key ? null : path.key));
                      }
                      if (event.key === "Escape") setTip(null);
                    }}
                    onMouseEnter={(event) => setTip({ label: path.label, value: path.value, share: path.share, x: event.clientX, y: event.clientY })}
                    onMouseLeave={() => setTip(null)}
                    onFocus={(event) => {
                      const box = event.currentTarget.getBoundingClientRect();
                      setTip({ label: path.label, value: path.value, share: path.share, x: box.left + box.width / 2, y: box.top });
                    }}
                    onBlur={() => setTip(null)}
                  />
                ))}
                <text x="120" y="112" textAnchor="middle" className="dash-donut-center-label">Giá trị vị thế</text>
                <text x="120" y="134" textAnchor="middle" className="dash-donut-center-value">{money(gross)}</text>
              </svg>
              <p className="muted dash-panel-meta">
                {coverage.positionsIncluded} vị thế · dữ liệu {allocation.asOf ? new Date(allocation.asOf).toISOString().replace("T", " ").slice(0, 19) : "—"} UTC
              </p>
            </div>

            <ul className="dash-donut-legend">
              {(pack?.slices || []).map((slice) => (
                <li key={slice.key}>
                  <button
                    type="button"
                    className={`dash-legend-btn${selected === slice.key ? " is-active" : ""}`}
                    onClick={() => setSelected((prev) => (prev === slice.key ? null : slice.key))}
                  >
                    <span className="dash-legend-swatch" style={{ background: slice.color }} aria-hidden />
                    <span className="dash-legend-name">{slice.label}</span>
                    <span className="dash-legend-val">{money(slice.value)}</span>
                    <span className="muted">{pct(slice.value, pack?.total)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {tip ? (
            <div className="dash-tip" style={{ left: tip.x + 12, top: tip.y + 12 }} role="tooltip">
              <strong>{tip.label}</strong>
              <span>{money(tip.value)} · {tip.share}%</span>
            </div>
          ) : null}

          <details className="dash-alloc-details" open={Boolean(selected)}>
            <summary>Xem dữ liệu{selected ? ` · ${selected === "__other__" ? "Khác" : selected}` : ""}</summary>
            {detailRows.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th>Exchange</th>
                      <th>Instrument</th>
                      <th>Side</th>
                      <th>Notional</th>
                      <th>%</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailRows.map((row) => (
                      <tr key={`${row.account}-${row.instrumentId}-${row.side}`}>
                        <td>{row.account}</td>
                        <td>{row.exchange || "—"}</td>
                        <td>{row.instrumentId || row.symbol}</td>
                        <td>{row.side}</td>
                        <td>{money(row.notional)}</td>
                        <td>{row.share == null ? "—" : `${row.share}%`}</td>
                        <td><Link className="ghost link-btn" to={row.href || "/terminal"}>Terminal</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">Không có dòng chi tiết cho lựa chọn này.</p>
            )}
          </details>
        </>
      )}
    </section>
  );
}
