import { useId, useMemo, useState } from "react";
import { money, moneyShort, pct, toneClass } from "./format.js";
import ChartShell from "./ChartShell.jsx";

const LOW = 20;

/**
 * Bubble: X = win rate, Y = profit, diện tích ∝ số lệnh (không phải bán kính).
 * Chỉ vẽ channel có trades > 0; winRate null bị loại khỏi bubble.
 */
export default function BubbleCompare({
  rows,
  selected = "",
  onSelect,
  loading = false,
  error = "",
  subtitle,
}) {
  const tipId = useId();
  const [tip, setTip] = useState(null);
  const [focus, setFocus] = useState("");

  const points = useMemo(() => {
    return (rows || [])
      .filter((row) => (Number(row.trades) || 0) > 0 && row.winRate != null && Number.isFinite(Number(row.winRate)))
      .map((row) => ({
        id: row.signal,
        name: row.signal,
        winRate: Number(row.winRate),
        profit: Number(row.profit) || 0,
        trades: Number(row.trades) || 0,
        lowSample: (Number(row.trades) || 0) < LOW,
        raw: row,
      }));
  }, [rows]);

  const noTrade = useMemo(
    () => (rows || []).filter((row) => !(Number(row.trades) > 0)),
    [rows]
  );

  const layout = useMemo(() => {
    if (!points.length) return null;
    const width = 640;
    const height = 280;
    const pad = { top: 20, right: 20, bottom: 36, left: 52 };
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;
    const maxTrades = Math.max(1, ...points.map((p) => p.trades));
    const profits = points.map((p) => p.profit);
    const minY = Math.min(0, ...profits);
    const maxY = Math.max(0, ...profits);
    const spanY = maxY - minY || 1;
    // Diện tích tỷ lệ trades → bán kính = sqrt(area)
    const maxArea = 900;
    const minArea = 36;
    const placed = points.map((p) => {
      const area = minArea + (p.trades / maxTrades) * (maxArea - minArea);
      const r = Math.sqrt(area / Math.PI);
      const x = pad.left + (Math.min(100, Math.max(0, p.winRate)) / 100) * innerW;
      const y = pad.top + ((maxY - p.profit) / spanY) * innerH;
      return { ...p, x, y, r, area };
    });
    const zeroY = pad.top + ((maxY - 0) / spanY) * innerH;
    return { width, height, pad, innerW, innerH, placed, zeroY, minY, maxY, spanY };
  }, [points]);

  const top = useMemo(() => {
    if (!points.length) return null;
    return [...points].sort((a, b) => Math.abs(b.profit) - Math.abs(a.profit))[0];
  }, [points]);

  function pick(name) {
    if (!onSelect) return;
    onSelect(selected === name ? "" : name);
  }

  const highlight = new Set(
    [selected, focus, tip, top?.name].filter(Boolean)
  );

  const dataColumns = [
    { key: "name", label: "Channel" },
    { key: "winRate", label: "Win rate", num: true, render: (row) => pct(row.winRate) },
    { key: "profit", label: "Profit", num: true, render: (row) => moneyShort(row.profit), tone: (row) => toneClass(row.profit) },
    { key: "trades", label: "Lệnh", num: true },
  ];

  return (
    <ChartShell
      title="Win rate và profit quan hệ thế nào?"
      subtitle={subtitle || "X = win rate · Y = profit USDT · diện tích = số lệnh · UTC · openTime"}
      summary={top
        ? `${top.name}: profit ${moneyShort(top.profit)}, win rate ${pct(top.winRate)}, ${top.trades} lệnh`
        : ""}
      loading={loading}
      error={error}
      empty={!loading && !error && !points.length
        ? (noTrade.length
          ? "Chưa có channel có lệnh để so sánh trên bubble. Channel chỉ có feed nằm ở mục riêng."
          : "Không có channel phù hợp.")
        : ""}
      dataRows={points}
      dataColumns={dataColumns}
    >
      {layout ? (
        <div className="dv-bubble-wrap">
          <svg
            className="dv-svg"
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            role="img"
            aria-label="Bubble win rate và profit"
          >
            <line x1={layout.pad.left} y1={layout.zeroY} x2={layout.width - layout.pad.right} y2={layout.zeroY} className="dv-axis-zero" />
            <text x={layout.pad.left - 6} y={layout.pad.top + 4} textAnchor="end" className="dv-axis-label">{moneyShort(layout.maxY)}</text>
            <text x={layout.pad.left - 6} y={layout.zeroY + 3} textAnchor="end" className="dv-axis-label">0</text>
            <text x={layout.pad.left - 6} y={layout.height - layout.pad.bottom} textAnchor="end" className="dv-axis-label">{moneyShort(layout.minY)}</text>
            <text x={layout.pad.left} y={layout.height - 8} textAnchor="start" className="dv-axis-label">0%</text>
            <text x={layout.pad.left + layout.innerW / 2} y={layout.height - 8} textAnchor="middle" className="dv-axis-label">Win rate</text>
            <text x={layout.width - layout.pad.right} y={layout.height - 8} textAnchor="end" className="dv-axis-label">100%</text>
            {layout.placed.map((p) => {
              const active = selected === p.name;
              const showLabel = highlight.has(p.name);
              return (
                <g key={p.id}>
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={p.r}
                    className={`dv-bubble ${p.profit >= 0 ? "up" : "down"}${active ? " active" : ""}${p.lowSample ? " low" : ""}`}
                    tabIndex={0}
                    role="button"
                    aria-pressed={active}
                    aria-label={`${p.name}: win rate ${pct(p.winRate)}, profit ${money(p.profit)}, ${p.trades} lệnh${p.lowSample ? ", ít dữ liệu" : ""}`}
                    onClick={() => pick(p.name)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        pick(p.name);
                      } else if (event.key === "Escape") setTip(null);
                    }}
                    onFocus={() => { setTip(p.name); setFocus(p.name); }}
                    onBlur={() => { setTip((cur) => (cur === p.name ? null : cur)); setFocus((cur) => (cur === p.name ? "" : cur)); }}
                    onMouseEnter={() => setTip(p.name)}
                    onMouseLeave={() => setTip((cur) => (cur === p.name ? null : cur))}
                  />
                  {showLabel ? (
                    <text x={p.x} y={p.y - p.r - 4} textAnchor="middle" className="dv-bubble-label">
                      {p.name}{p.lowSample ? " · ít" : ""}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
          {tip ? (
            <div role="tooltip" id={tipId} className="dv-tooltip floating">
              {(() => {
                const p = layout.placed.find((item) => item.name === tip);
                if (!p) return null;
                return (
                  <>
                    <strong>{p.name}</strong>
                    <span>Win rate {pct(p.winRate)} · profit {money(p.profit)}</span>
                    <span>{p.trades} lệnh{p.lowSample ? " · Ít dữ liệu (&lt;20)" : ""}</span>
                  </>
                );
              })()}
            </div>
          ) : null}
        </div>
      ) : null}
      {noTrade.length ? (
        <div className="dv-notrade">
          <h3 className="dv-notrade-title">Channel chưa có lệnh ({noTrade.length})</h3>
          <p className="muted">Không gán win rate = 0 trên bubble. Chỉ hiện feed / tên.</p>
          <ul className="dv-notrade-list">
            {noTrade.slice(0, 12).map((row) => (
              <li key={row.signal}>
                <button type="button" className="ghost" onClick={() => pick(row.signal)}>
                  {row.signal}
                </button>
                <span className="muted">feed {row.feed || 0}</span>
              </li>
            ))}
          </ul>
          {noTrade.length > 12 ? <p className="muted">… và {noTrade.length - 12} channel khác</p> : null}
        </div>
      ) : null}
    </ChartShell>
  );
}
