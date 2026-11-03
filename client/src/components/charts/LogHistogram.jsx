import { useId, useState } from "react";
import ChartShell from "./ChartShell.jsx";

const LEVELS = [
  { key: "error", label: "Error", className: "error" },
  { key: "warn", label: "Warn", className: "warn" },
  { key: "info", label: "Info", className: "info" },
];

/**
 * Cột chồng error/warn/info theo bucket giờ/ngày UTC.
 * Bấm cột → chọn bucket; bấm legend mức → chọn level.
 */
export default function LogHistogram({
  title = "Log theo thời gian phân bố thế nào?",
  subtitle,
  summary = "",
  points = [],
  bucket = "hour",
  selectedBucket = "",
  selectedLevel = "",
  onSelectBucket,
  onSelectLevel,
  loading = false,
  error = "",
  total = null,
}) {
  const tipId = useId();
  const [tip, setTip] = useState(null);
  const rows = points || [];
  const max = Math.max(1, ...rows.map((row) => Number(row.total) || ((Number(row.error) || 0) + (Number(row.warn) || 0) + (Number(row.info) || 0))));

  const dataRows = rows.map((row) => ({
    id: row.t,
    t: row.t,
    error: Number(row.error) || 0,
    warn: Number(row.warn) || 0,
    info: Number(row.info) || 0,
    total: Number(row.total) || ((Number(row.error) || 0) + (Number(row.warn) || 0) + (Number(row.info) || 0)),
  }));

  const recorded = total != null ? total : dataRows.reduce((sum, row) => sum + row.total, 0);
  const autoSummary = dataRows.length
    ? `${recorded} log đã ghi nhận · bucket ${bucket === "hour" ? "1 giờ" : "ngày"} UTC · ${dataRows.length} cột`
    : "";

  function pickBucket(t) {
    if (!onSelectBucket) return;
    onSelectBucket(selectedBucket === t ? "" : t);
  }

  return (
    <ChartShell
      title={title}
      subtitle={subtitle || "Chỉ đếm số log đã ghi nhận — không suy ra số sự cố độc lập hoặc uptime."}
      summary={summary || autoSummary}
      loading={loading}
      error={error}
      empty={!loading && !error && !dataRows.length ? "Chưa có log trong kỳ đang xem." : ""}
      dataRows={dataRows}
      dataColumns={[
        { key: "t", label: "Bucket UTC" },
        { key: "error", label: "Error", num: true },
        { key: "warn", label: "Warn", num: true },
        { key: "info", label: "Info", num: true },
        { key: "total", label: "Tổng", num: true },
      ]}
      actions={(
        <div className="dv-mode-tabs" role="group" aria-label="Mức log">
          <button type="button" className={!selectedLevel ? "active" : "ghost"} aria-pressed={!selectedLevel} onClick={() => onSelectLevel?.("")}>
            Mọi mức
          </button>
          {LEVELS.map((level) => (
            <button
              key={level.key}
              type="button"
              className={selectedLevel === level.key ? "active" : "ghost"}
              aria-pressed={selectedLevel === level.key}
              onClick={() => onSelectLevel?.(selectedLevel === level.key ? "" : level.key)}
            >
              {level.label}
            </button>
          ))}
        </div>
      )}
    >
      <div className="dv-log-hist" role="img" aria-label="Histogram log theo mức">
        {dataRows.map((row) => {
          const height = `${Math.max(4, (row.total / max) * 100)}%`;
          const active = selectedBucket === row.t;
          const errH = row.total ? (row.error / row.total) * 100 : 0;
          const warnH = row.total ? (row.warn / row.total) * 100 : 0;
          const infoH = row.total ? (row.info / row.total) * 100 : 0;
          return (
            <button
              key={row.t}
              type="button"
              className={`dv-log-col${active ? " active" : ""}`}
              style={{ height }}
              aria-pressed={active}
              aria-describedby={tip === row.t ? tipId : undefined}
              aria-label={`${row.t}: error ${row.error}, warn ${row.warn}, info ${row.info}`}
              onClick={() => pickBucket(row.t)}
              onMouseEnter={() => setTip(row.t)}
              onMouseLeave={() => setTip((cur) => (cur === row.t ? null : cur))}
              onFocus={() => setTip(row.t)}
              onBlur={() => setTip((cur) => (cur === row.t ? null : cur))}
            >
              <span className="dv-log-stack" aria-hidden="true">
                <span className="dv-log-seg error" style={{ height: `${errH}%` }} />
                <span className="dv-log-seg warn" style={{ height: `${warnH}%` }} />
                <span className="dv-log-seg info" style={{ height: `${infoH}%` }} />
              </span>
              {tip === row.t ? (
                <span role="tooltip" id={tipId} className="dv-tooltip dv-log-tip">
                  <strong>{row.t}</strong>
                  <span>Error {row.error} · Warn {row.warn} · Info {row.info}</span>
                  <span>Số log đã ghi nhận trong bucket: {row.total}</span>
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <ul className="dv-share-legend">
        <li><span className="dv-share-swatch log-error" /> Error</li>
        <li><span className="dv-share-swatch log-warn" /> Warn</li>
        <li><span className="dv-share-swatch log-info" /> Info</li>
      </ul>
    </ChartShell>
  );
}
