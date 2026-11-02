import { useId, useMemo, useState } from "react";
import { compact, money, moneyShort, toneClass } from "./format.js";
import ChartShell from "./ChartShell.jsx";

/**
 * Biểu đồ cột PnL ngày + đường lũy kế lệnh (từ 0).
 */
export default function DayPnlBars({
  series,
  selectedDay = "",
  onSelectDay,
  timeField = "closeTime",
  loading = false,
  error = "",
  subtitle,
}) {
  const tipId = useId();
  const [tip, setTip] = useState(null);
  const rows = series || [];

  const layout = useMemo(() => {
    if (!rows.length) return null;
    const width = Math.min(720, Math.max(320, rows.length * 18));
    const height = 240;
    const pad = { top: 16, right: 12, bottom: 28, left: 48 };
    const profits = rows.map((row) => Number(row.profit) || 0);
    const cumulatives = rows.map((row) => Number(row.cumulative) || 0);
    const minBar = Math.min(0, ...profits);
    const maxBar = Math.max(0, ...profits);
    const minLine = Math.min(0, ...cumulatives);
    const maxLine = Math.max(0, ...cumulatives);
    const barSpan = maxBar - minBar || 1;
    const lineSpan = maxLine - minLine || 1;
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;
    const zeroY = pad.top + ((maxBar - 0) / barSpan) * innerH;
    const barW = Math.max(2, (innerW / Math.max(rows.length, 1)) * 0.62);
    const points = rows.map((row, index) => {
      const x = pad.left + ((index + 0.5) * innerW) / Math.max(rows.length, 1);
      const y = pad.top + ((maxLine - (Number(row.cumulative) || 0)) / lineSpan) * innerH;
      return `${x},${y}`;
    }).join(" ");
    const yTicks = [maxBar, 0, minBar].filter((value, index, all) => all.indexOf(value) === index);
    return {
      width, height, pad, innerW, innerH, zeroY, barW, barSpan, maxBar, minBar, points, yTicks,
    };
  }, [rows]);

  const totalPnl = rows.reduce((sum, row) => sum + (Number(row.profit) || 0), 0);
  const activeDays = rows.filter((row) => (row.trades || 0) > 0 || Number(row.profit)).length;
  const summary = rows.length
    ? `${activeDays} ngày có lệnh · PnL lũy kế lệnh ${moneyShort(totalPnl)} (bắt đầu từ 0, không phải số dư ví)`
    : "";

  function pick(day) {
    if (!onSelectDay) return;
    onSelectDay(selectedDay === day ? "" : day);
  }

  const dataColumns = [
    { key: "day", label: "Ngày UTC" },
    { key: "trades", label: "Lệnh", num: true },
    { key: "profit", label: "PnL ngày", num: true, render: (row) => moneyShort(row.profit), tone: (row) => toneClass(row.profit) },
    { key: "cumulative", label: "Lũy kế lệnh", num: true, render: (row) => moneyShort(row.cumulative), tone: (row) => toneClass(row.cumulative) },
  ];

  return (
    <ChartShell
      title="PnL thay đổi theo ngày ra sao?"
      subtitle={subtitle || `${rows.length} ngày · USDT · lệnh đóng · UTC · trục theo closeTime${timeField === "openTime" ? " (lọc openTime vẫn bucket theo ngày đóng)" : ""}`}
      summary={summary}
      loading={loading}
      error={error}
      empty={!loading && !error && !rows.length ? "Chưa có chuỗi PnL ngày trong kỳ đang xem." : ""}
      dataRows={rows}
      dataColumns={dataColumns}
    >
      {layout ? (
        <div className="dv-day-wrap">
          <svg
            className="dv-svg"
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            role="img"
            aria-label="Biểu đồ PnL theo ngày UTC"
          >
            <line x1={layout.pad.left} y1={layout.zeroY} x2={layout.width - layout.pad.right} y2={layout.zeroY} className="dv-axis-zero" />
            {layout.yTicks.map((value) => {
              const y = layout.pad.top + ((layout.maxBar - value) / layout.barSpan) * layout.innerH;
              return (
                <g key={`y-${value}`}>
                  <text x={layout.pad.left - 6} y={y + 3} textAnchor="end" className="dv-axis-label">{compact(value)}</text>
                </g>
              );
            })}
            {rows.map((row, index) => {
              const x = layout.pad.left + ((index + 0.5) * layout.innerW) / Math.max(rows.length, 1) - layout.barW / 2;
              const value = Number(row.profit) || 0;
              const y = value >= 0
                ? layout.pad.top + ((layout.maxBar - value) / layout.barSpan) * layout.innerH
                : layout.zeroY;
              const h = Math.abs((value / layout.barSpan) * layout.innerH);
              const active = selectedDay === row.day;
              return (
                <rect
                  key={row.day}
                  x={x}
                  y={y}
                  width={layout.barW}
                  height={Math.max(h, value === 0 ? 1 : 0)}
                  className={`dv-day-bar ${value >= 0 ? "up" : "down"}${active ? " active" : ""}`}
                  tabIndex={0}
                  role="button"
                  aria-pressed={active}
                  aria-label={`${row.day} UTC: ${row.trades || 0} lệnh, PnL ngày ${money(row.profit)}, lũy kế ${money(row.cumulative)}`}
                  onClick={() => pick(row.day)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      pick(row.day);
                    } else if (event.key === "Escape") setTip(null);
                  }}
                  onFocus={() => setTip(row.day)}
                  onBlur={() => setTip((cur) => (cur === row.day ? null : cur))}
                  onMouseEnter={() => setTip(row.day)}
                  onMouseLeave={() => setTip((cur) => (cur === row.day ? null : cur))}
                />
              );
            })}
            <polyline fill="none" className="dv-cum-line" strokeWidth="2" points={layout.points} />
            {rows.filter((_, index) => index === 0 || index === rows.length - 1 || index % Math.ceil(rows.length / 6) === 0).map((row) => {
              const index = rows.indexOf(row);
              const x = layout.pad.left + ((index + 0.5) * layout.innerW) / Math.max(rows.length, 1);
              return <text key={`x-${row.day}`} x={x} y={layout.height - 8} textAnchor="middle" className="dv-axis-label">{row.day.slice(5)}</text>;
            })}
          </svg>
          {tip ? (
            <div role="tooltip" id={tipId} className="dv-tooltip floating">
              {(() => {
                const row = rows.find((item) => item.day === tip);
                if (!row) return null;
                return (
                  <>
                    <strong>{row.day} UTC</strong>
                    <span>PnL ngày {money(row.profit)}</span>
                    <span>{row.trades || 0} lệnh · lũy kế lệnh {money(row.cumulative)}</span>
                  </>
                );
              })()}
            </div>
          ) : null}
          <p className="dv-legend">
            <span className="dv-leg up">PnL ngày</span>
            <span className="dv-leg line">PnL lũy kế lệnh</span>
          </p>
        </div>
      ) : null}
    </ChartShell>
  );
}
