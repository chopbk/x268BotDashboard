/**
 * Infographic kiểu Smart Signal panel — ý tưởng layout từ 0xBennie (MIT, tái triển khai).
 * Không gọi sàn; chỉ render snapshot đã normalize.
 */

function finite(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtUsd(v) {
  const n = finite(v);
  if (n == null) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${n < 0 ? "-" : ""}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${n < 0 ? "-" : ""}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${n < 0 ? "-" : ""}$${(abs / 1e3).toFixed(1)}K`;
  return `${n < 0 ? "-" : ""}$${abs.toFixed(0)}`;
}

function fmtPrice(v) {
  const n = finite(v);
  if (n == null) return "—";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function fmtPct01(v) {
  const n = finite(v);
  if (n == null) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function buildSide(traders, whales, mark, isLong) {
  const count = finite(isLong ? traders?.longCount : traders?.shortCount);
  const whaleCount = finite(isLong ? whales?.longCount : whales?.shortCount);
  const qty = finite(isLong ? traders?.longQty : traders?.shortQty);
  const avg = finite(isLong ? traders?.avgEntry ?? traders?.longAvgEntry : traders?.shortAvgEntry);
  const notional =
    finite(isLong ? traders?.longNotional : traders?.shortNotional) ??
    (qty != null && avg != null && avg > 0 ? qty * avg : null);
  const profitCount = finite(isLong ? traders?.longProfitCount : traders?.shortProfitCount);
  const profitPct =
    count != null && count > 0 && profitCount != null ? Math.max(0, Math.min(1, profitCount / count)) : null;
  let pnlUsd = null;
  if (mark != null && mark > 0 && qty != null && avg != null && avg > 0) {
    pnlUsd = isLong ? qty * (mark - avg) : qty * (avg - mark);
  }
  return { count, whaleCount, notional, avg, profitPct, pnlUsd };
}

export function computePanelFromSnapshot(snap) {
  if (!snap) return null;
  const mark = finite(snap.price?.mark);
  const traders = snap.smartMoney?.traders || {};
  const whales = snap.smartMoney?.whales || {};
  const long = buildSide(traders, whales, mark, true);
  const short = buildSide(traders, whales, mark, false);
  // Whale counts override display of whale unit
  long.whaleCount = finite(whales.longCount);
  short.whaleCount = finite(whales.shortCount);
  const totalNotional = (long.notional || 0) + (short.notional || 0);
  const longShare = totalNotional > 0 && long.notional != null ? long.notional / totalNotional : null;
  const ratio =
    short.notional != null && short.notional > 0 && long.notional != null
      ? long.notional / short.notional
      : null;
  const oiNotional = finite(snap.openInterest?.notional);
  const smShareOfOi =
    oiNotional != null && oiNotional > 0 && totalNotional > 0 ? totalNotional / oiNotional : null;
  return {
    symbol: snap.symbol,
    mark,
    totalNotional: totalNotional > 0 ? totalNotional : null,
    totalTraders: (long.count || 0) + (short.count || 0) || null,
    longShare,
    ratio,
    long,
    short,
    topLsr: finite(snap.topTrader?.positionLsr),
    taker: finite(snap.taker?.buySellRatio),
    smShareOfOi,
    oiNotional,
    oiDeltaPct: finite(snap.openInterest?.deltaPct),
    collectedAt: snap.collectedAt,
    smStatus: snap.smartMoney?.status,
  };
}

function SideCard({ label, side, up }) {
  const col = up ? "long" : "short";
  const state =
    side.pnlUsd == null ? null : side.pnlUsd >= 0 ? "Đang lãi" : "Đang lỗ";
  const barPct = side.profitPct != null ? Math.max(0, Math.min(100, side.profitPct * 100)) : 0;
  return (
    <div className={`sm-panel-side sm-panel-side-${col}`}>
      <div className="sm-panel-side-head">
        <span>
          {up ? "▲" : "▼"} {label}
          {side.count != null ? (
            <span className="sm-panel-muted">
              {" "}
              · {side.count} trader
              {side.whaleCount != null ? ` (${side.whaleCount} whale)` : ""}
            </span>
          ) : null}
        </span>
        {state ? <span className={`sm-panel-state ${side.pnlUsd >= 0 ? "pos" : "neg"}`}>{state}</span> : null}
      </div>
      <div className="sm-panel-side-grid">
        <div>
          <span className="sm-panel-muted">Vị thế</span>
          <strong>{fmtUsd(side.notional)}</strong>
        </div>
        <div>
          <span className="sm-panel-muted">Entry TB</span>
          <strong>{fmtPrice(side.avg)}</strong>
        </div>
        <div>
          <span className="sm-panel-muted">PNL ước tính</span>
          <strong className={side.pnlUsd == null ? "" : side.pnlUsd >= 0 ? "pos" : "neg"}>{fmtUsd(side.pnlUsd)}</strong>
        </div>
        <div>
          <span className="sm-panel-muted">% đang lãi</span>
          <strong className={side.profitPct == null ? "" : "pos"}>{fmtPct01(side.profitPct)}</strong>
        </div>
      </div>
      <div className="sm-panel-profit-track">
        <div className={`sm-panel-profit-fill ${col}`} style={{ width: `${barPct}%` }} />
      </div>
    </div>
  );
}

export default function SmOverviewPanel({ snapshot }) {
  const d = computePanelFromSnapshot(snapshot);
  if (!d) return null;
  if (d.smStatus && d.smStatus !== "ok") {
    return (
      <div className="sm-panel sm-panel-empty">
        <p className="muted">Chưa có Smart Money đủ để vẽ panel (status: {d.smStatus}).</p>
      </div>
    );
  }
  const longPct = d.longShare != null ? Math.max(2, Math.min(98, d.longShare * 100)) : 50;
  const base = String(d.symbol || "").replace(/USDT$/, "");

  return (
    <div className="sm-panel">
      <header className="sm-panel-head">
        <div>
          <strong className="sm-panel-title">{base}</strong>
          <span className="sm-panel-muted"> Smart Money</span>
        </div>
        <div className="sm-panel-muted">{d.mark != null ? `$${fmtPrice(d.mark)}` : "—"}</div>
      </header>

      <div className="sm-panel-kpis">
        <div>
          <div className="sm-panel-muted">Tổng vị thế</div>
          <div className="sm-panel-kpi">{fmtUsd(d.totalNotional)}</div>
        </div>
        <div>
          <div className="sm-panel-muted">Traders</div>
          <div className="sm-panel-kpi">{d.totalTraders ?? "—"}</div>
        </div>
        <div>
          <div className="sm-panel-muted">Tỷ lệ L/S</div>
          <div className="sm-panel-kpi">{d.ratio != null ? d.ratio.toFixed(2) : "—"}</div>
        </div>
      </div>

      <div className="sm-panel-split" title="Tỷ trọng notional Long / Short">
        <div className="sm-panel-split-long" style={{ width: `${longPct}%` }} />
        <div className="sm-panel-split-short" />
      </div>

      <SideCard label="Long" side={d.long} up />
      <SideCard label="Short" side={d.short} up={false} />

      <div className="sm-panel-foot-stats">
        <span>
          Top LSR <b>{d.topLsr != null ? d.topLsr.toFixed(2) : "—"}</b>
        </span>
        <span>
          Taker <b>{d.taker != null ? d.taker.toFixed(2) : "—"}</b>
        </span>
        <span>
          SM/OI <b>{fmtPct01(d.smShareOfOi)}</b>
        </span>
        <span>
          OI <b>{fmtUsd(d.oiNotional)}</b>{" "}
          {d.oiDeltaPct != null ? (
            <span className={d.oiDeltaPct >= 0 ? "pos" : "neg"}>
              {d.oiDeltaPct >= 0 ? "+" : ""}
              {d.oiDeltaPct.toFixed(2)}%
            </span>
          ) : null}
        </span>
      </div>
      <p className="sm-panel-disclaimer muted">Chỉ phân tích dữ liệu — không phải lời khuyên đầu tư.</p>
    </div>
  );
}

export function SmLsMiniBar({ longQty, shortQty }) {
  const l = finite(longQty);
  const s = finite(shortQty);
  if (l == null && s == null) return <span className="muted">—</span>;
  const total = (l || 0) + (s || 0);
  const longPct = total > 0 ? Math.max(4, Math.min(96, ((l || 0) / total) * 100)) : 50;
  return (
    <div className="sm-mini-ls" title={`L ${l ?? "—"} / S ${s ?? "—"}`}>
      <div className="sm-mini-ls-long" style={{ width: `${longPct}%` }} />
      <div className="sm-mini-ls-short" />
    </div>
  );
}
