import { useId, useMemo, useState } from "react";
import { compact, finite, money, moneyShort, toneClass } from "./format.js";
import ChartShell from "./ChartShell.jsx";

/**
 * Chuỗi thời gian SVG: trục ngày/giá trị, gap khi null, tooltip, legend.
 * Không nối qua điểm thiếu như thể có snapshot.
 */
export default function TimeSeriesLines({
  title,
  subtitle,
  summary,
  points,
  series,
  xKey = "ymd",
  loading = false,
  error = "",
  empty = "",
  unit = "USDT",
}) {
  const tipId = useId();
  const [tipIndex, setTipIndex] = useState(null);
  const rows = points || [];

  const layout = useMemo(() => {
    if (rows.length < 1) return null;
    const width = Math.min(720, Math.max(360, rows.length * 14));
    const height = 240;
    const pad = { top: 16, right: 16, bottom: 32, left: 52 };
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;
    const values = [];
    for (const spec of series || []) {
      for (const row of rows) {
        const n = finite(row[spec.key]);
        if (n != null) values.push(n);
      }
    }
    if (!values.length) return { width, height, pad, innerW, innerH, min: 0, max: 1, span: 1, paths: [], dots: [] };
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const xAt = (index) => pad.left + (rows.length === 1 ? innerW / 2 : (index * innerW) / (rows.length - 1));
    const yAt = (value) => pad.top + ((max - value) / span) * innerH;

    const paths = (series || []).map((spec) => {
      const segments = [];
      let current = [];
      const dots = [];
      rows.forEach((row, index) => {
        const n = finite(row[spec.key]);
        const x = xAt(index);
        if (n == null) {
          if (current.length) {
            segments.push(current);
            current = [];
          }
          return;
        }
        const y = yAt(n);
        current.push(`${x},${y}`);
        dots.push({ x, y, index, key: spec.key, value: n, className: spec.className || "" });
      });
      if (current.length) segments.push(current);
      return { ...spec, segments, dots };
    });

    const yTicks = [max, (max + min) / 2, min];
    return { width, height, pad, innerW, innerH, min, max, span, paths, xAt, yAt, yTicks };
  }, [rows, series]);

  const tipRow = tipIndex != null ? rows[tipIndex] : null;

  const dataColumns = [
    { key: xKey, label: "Ngày UTC" },
    ...(series || []).map((spec) => ({
      key: spec.key,
      label: spec.label,
      num: true,
      render: (row) => (finite(row[spec.key]) == null ? "Thiếu dữ liệu" : moneyShort(row[spec.key])),
      tone: (row) => toneClass(row[spec.key]),
    })),
  ];

  return (
    <ChartShell
      title={title}
      subtitle={subtitle}
      summary={summary}
      loading={loading}
      error={error}
      empty={!loading && !error && rows.length < 1 ? (empty || "Chưa có điểm dữ liệu.") : ""}
      dataRows={rows}
      dataColumns={dataColumns}
    >
      {rows.length === 1 && layout ? (
        <p className="muted">Một điểm trong kỳ — không vẽ xu hướng giả.</p>
      ) : null}
      {layout && rows.length >= 1 ? (
        <div className="dv-ts-wrap">
          <svg
            className="dv-svg"
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            role="img"
            aria-label={title || "Chuỗi thời gian"}
          >
            {layout.yTicks.map((value, index) => {
              const y = layout.pad.top + ((layout.max - value) / layout.span) * layout.innerH;
              return (
                <g key={`yt-${index}`}>
                  <line x1={layout.pad.left} y1={y} x2={layout.width - layout.pad.right} y2={y} className="dv-grid" />
                  <text x={layout.pad.left - 6} y={y + 3} textAnchor="end" className="dv-axis-label">{compact(value)}</text>
                </g>
              );
            })}
            {layout.paths.map((path) => (
              path.segments.map((seg, si) => (
                <polyline
                  key={`${path.key}-s${si}`}
                  fill="none"
                  strokeWidth="2"
                  className={path.className || "dv-ts-line"}
                  points={seg.join(" ")}
                />
              ))
            ))}
            {layout.paths.flatMap((path) => path.dots.map((dot) => (
              <circle
                key={`${path.key}-d${dot.index}`}
                cx={dot.x}
                cy={dot.y}
                r={tipIndex === dot.index ? 4.5 : 3}
                className={`dv-ts-dot ${path.className || ""}`}
                tabIndex={0}
                role="button"
                aria-label={`${rows[dot.index]?.[xKey]}: ${path.label} ${money(dot.value)} ${unit}`}
                onFocus={() => setTipIndex(dot.index)}
                onBlur={() => setTipIndex((cur) => (cur === dot.index ? null : cur))}
                onMouseEnter={() => setTipIndex(dot.index)}
                onMouseLeave={() => setTipIndex((cur) => (cur === dot.index ? null : cur))}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setTipIndex(null);
                }}
              />
            )))}
            {/* Gap markers: ngày có ít nhất một series null */}
            {rows.map((row, index) => {
              const missing = (series || []).some((spec) => finite(row[spec.key]) == null);
              if (!missing) return null;
              const x = layout.xAt(index);
              return (
                <line
                  key={`gap-${index}`}
                  x1={x}
                  y1={layout.pad.top}
                  x2={x}
                  y2={layout.height - layout.pad.bottom}
                  className="dv-gap"
                />
              );
            })}
            {rows.filter((_, index) => index === 0 || index === rows.length - 1 || index % Math.ceil(rows.length / 6) === 0).map((row) => {
              const index = rows.indexOf(row);
              return (
                <text
                  key={`x-${row[xKey]}`}
                  x={layout.xAt(index)}
                  y={layout.height - 8}
                  textAnchor="middle"
                  className="dv-axis-label"
                >
                  {String(row[xKey] || "").slice(5)}
                </text>
              );
            })}
          </svg>
          {tipRow ? (
            <div role="tooltip" id={tipId} className="dv-tooltip floating">
              <strong>{tipRow[xKey]} UTC</strong>
              {(series || []).map((spec) => {
                const n = finite(tipRow[spec.key]);
                return (
                  <span key={spec.key}>
                    {spec.label}: {n == null ? "Thiếu dữ liệu" : money(n)}
                  </span>
                );
              })}
            </div>
          ) : null}
          <p className="dv-legend">
            {(series || []).map((spec) => (
              <span key={spec.key} className={`dv-leg ${spec.legendClass || ""}`}>{spec.label}</span>
            ))}
            <span className="dv-leg gap">Khoảng trống = thiếu snapshot</span>
          </p>
        </div>
      ) : null}
      {rows.length > 0 && rows.length < 2 ? (
        <div className="dv-single-point">
          {(series || []).map((spec) => (
            <p key={spec.key}>
              <strong>{spec.label}:</strong>{" "}
              {finite(rows[0][spec.key]) == null ? "Thiếu dữ liệu" : money(rows[0][spec.key])}
            </p>
          ))}
        </div>
      ) : null}
    </ChartShell>
  );
}
