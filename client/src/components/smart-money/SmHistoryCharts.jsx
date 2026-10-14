/**
 * Biểu đồ time-series SVG (ý tưởng 0xBennie render_chart) — không thêm thư viện.
 * 3 panel: long qty · short qty · whale avg entry vs mark.
 */

const GREEN = "#2ebd85";
const RED = "#f6465d";
const AMBER = "#f0b90b";
const W = 520;
const PLOT_H = 88;
const GAP = 36;
const PAD_L = 6;
const PAD_R = 44;
const PLOT_W = W - PAD_L - PAD_R;

function finite(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtQty(v) {
  const n = finite(v);
  if (n == null) return "—";
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(2);
}

function fmtPrice(v) {
  const n = finite(v);
  if (n == null) return "—";
  if (n >= 1000) return n.toFixed(1);
  if (n >= 1) return n.toFixed(3);
  return n.toFixed(5);
}

function pointsFromHistory(points) {
  const rows = [];
  for (const p of points || []) {
    const snap = p.snapshot || {};
    const traders = snap.smartMoney?.traders || {};
    const whales = snap.smartMoney?.whales || {};
    const ts = new Date(p.collectedAt || snap.collectedAt).getTime();
    if (!Number.isFinite(ts)) continue;
    rows.push({
      ts,
      longQty: finite(traders.longQty),
      shortQty: finite(traders.shortQty),
      longWhaleAvg: finite(whales.longAvgEntry),
      shortWhaleAvg: finite(whales.shortAvgEntry),
      mark: finite(snap.price?.mark),
    });
  }
  rows.sort((a, b) => a.ts - b.ts);
  return rows;
}

function linePanel(title, rows, topY, series, fmt) {
  const materialized = series.map((s) => {
    const pts = [];
    for (const r of rows) {
      const v = s.getVal(r);
      if (v != null && Number.isFinite(v) && v > 0) pts.push({ ts: r.ts, v });
    }
    return { s, pts };
  });
  const vals = materialized.flatMap(({ pts }) => pts.map((p) => p.v));
  if (!vals.length) {
    return (
      <g transform={`translate(0,${topY})`}>
        <text x={PAD_L} y={12} fill="#848e9c" fontSize="11">
          {title} — chưa đủ điểm
        </text>
      </g>
    );
  }
  const vmin = Math.min(...vals);
  const vmax = Math.max(...vals);
  const pad = (vmax - vmin) * 0.08 || vmax * 0.08 || 1;
  const lo = Math.max(0, vmin - pad);
  const hi = vmax + pad;
  const t0 = rows[0].ts;
  const t1 = rows[rows.length - 1].ts;
  const tSpan = t1 - t0 || 1;
  const vSpan = hi - lo || 1;

  return (
    <g transform={`translate(0,${topY})`}>
      <text x={PAD_L} y={0} fill="#848e9c" fontSize="11">
        {title}
      </text>
      <text x={W - PAD_R} y={14} fill="#5e6673" fontSize="9" textAnchor="end">
        {fmt(hi)}
      </text>
      <text x={W - PAD_R} y={PLOT_H + 4} fill="#5e6673" fontSize="9" textAnchor="end">
        {fmt(lo)}
      </text>
      <rect x={PAD_L} y={8} width={PLOT_W} height={PLOT_H} fill="none" stroke="#2b3139" />
      {materialized.map(({ s, pts }) => {
        if (pts.length < 2) return null;
        const d = pts
          .map(({ ts, v }) => {
            const x = PAD_L + ((ts - t0) / tSpan) * PLOT_W;
            const y = 8 + PLOT_H - ((v - lo) / vSpan) * PLOT_H;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(" ");
        return <polyline key={s.label} points={d} fill="none" stroke={s.color} strokeWidth="1.75" />;
      })}
      {materialized.map(({ s, pts }, i) => {
        const last = pts.length ? pts[pts.length - 1].v : null;
        return (
          <text key={`l-${s.label}`} x={PAD_L + 4} y={22 + i * 12} fill={s.color} fontSize="10">
            {s.label} {last != null ? fmt(last) : "—"}
          </text>
        );
      })}
    </g>
  );
}

export default function SmHistoryCharts({ points }) {
  const rows = pointsFromHistory(points);
  if (rows.length < 2) {
    return (
      <div className="sm-chart-empty muted">
        Chưa đủ lịch sử để vẽ biểu đồ (≥2 snapshot). Collector sẽ tích lũy dần.
      </div>
    );
  }
  const p1 = 28;
  const p2 = p1 + PLOT_H + GAP;
  const p3 = p2 + PLOT_H + GAP;
  const H = p3 + PLOT_H + 24;
  const t0 = new Date(rows[0].ts).toLocaleString("vi-VN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const t1 = new Date(rows[rows.length - 1].ts).toLocaleString("vi-VN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="sm-chart">
      <div className="sm-chart-meta muted">
        {rows.length} điểm · {t0} → {t1}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="sm-chart-svg" role="img" aria-label="Biểu đồ Smart Money theo thời gian">
        {linePanel("Long qty", rows, p1, [{ label: "Long", color: GREEN, getVal: (r) => r.longQty }], fmtQty)}
        {linePanel("Short qty", rows, p2, [{ label: "Short", color: RED, getVal: (r) => r.shortQty }], fmtQty)}
        {linePanel(
          "Whale entry vs mark",
          rows,
          p3,
          [
            { label: "Whale L", color: GREEN, getVal: (r) => r.longWhaleAvg },
            { label: "Whale S", color: RED, getVal: (r) => r.shortWhaleAvg },
            { label: "Mark", color: AMBER, getVal: (r) => r.mark },
          ],
          fmtPrice
        )}
      </svg>
    </div>
  );
}
