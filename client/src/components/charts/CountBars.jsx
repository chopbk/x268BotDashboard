import { useId, useState } from "react";
import ChartShell from "./ChartShell.jsx";

/**
 * Bar ngang theo số đếm (không phải PnL).
 * Dùng màu accent/category — không gắn lãi/lỗ.
 */
export default function CountBars({
  title,
  subtitle,
  summary = "",
  rows = [],
  nameKey = "name",
  valueKey = "count",
  valueLabel = "Số",
  selected = "",
  onSelect,
  limit = 10,
  loading = false,
  error = "",
  empty = "",
  unit = "",
}) {
  const tipId = useId();
  const [tip, setTip] = useState(null);
  const [expanded, setExpanded] = useState(false);

  const list = (rows || [])
    .map((row, index) => {
      const name = String(row[nameKey] ?? row.signal ?? row.name ?? `#${index + 1}`);
      const value = Number(row[valueKey]);
      return {
        id: name,
        name,
        value: Number.isFinite(value) ? value : null,
        meta: row.meta || "",
        raw: row,
      };
    })
    .filter((row) => row.value != null && row.value > 0)
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));

  const shown = list.slice(0, expanded ? 50 : Math.max(1, limit));
  const rest = list.slice(shown.length);
  const max = Math.max(1, ...shown.map((row) => row.value));
  const total = list.reduce((sum, row) => sum + row.value, 0);

  function pick(name) {
    if (!onSelect) return;
    onSelect(selected === name ? "" : name);
  }

  function onKey(event, name) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pick(name);
    } else if (event.key === "Escape") {
      setTip(null);
    }
  }

  const autoSummary = shown.length
    ? `${shown[0].name}: ${shown[0].value}${unit ? ` ${unit}` : ""} · top ${shown.length}/${list.length}${rest.length ? ` · còn ${rest.length} nhóm` : ""}`
    : summary;

  return (
    <ChartShell
      title={title}
      subtitle={subtitle}
      summary={summary || autoSummary}
      loading={loading}
      error={error}
      empty={!loading && !error && !shown.length ? (empty || "Không có nhóm có số liệu để vẽ.") : ""}
      dataRows={shown}
      dataColumns={[
        { key: "name", label: "Nhóm" },
        { key: "value", label: valueLabel, num: true, render: (row) => `${row.value}${unit ? ` ${unit}` : ""}` },
      ]}
      height="rank"
    >
      <p className="muted dv-rank-meta">
        Top {shown.length}/{list.length} · tổng {total}{unit ? ` ${unit}` : ""}
        {rest.length ? ` · phần còn lại ${rest.reduce((s, r) => s + r.value, 0)}` : ""}
      </p>
      <ul className="dv-hbar-list" role="list">
        {shown.map((row) => {
          const width = `${Math.max(2, (row.value / max) * 100)}%`;
          const active = selected === row.name;
          return (
            <li key={row.id} className={`dv-hbar-row${active ? " active" : ""}`}>
              <button
                type="button"
                className="dv-hbar-hit dv-count-hit"
                aria-pressed={active}
                aria-describedby={tip === row.name ? tipId : undefined}
                aria-label={`${row.name}: ${row.value}${unit ? ` ${unit}` : ""}`}
                onClick={() => pick(row.name)}
                onKeyDown={(event) => onKey(event, row.name)}
                onFocus={() => setTip(row.name)}
                onBlur={() => setTip((cur) => (cur === row.name ? null : cur))}
                onMouseEnter={() => setTip(row.name)}
                onMouseLeave={() => setTip((cur) => (cur === row.name ? null : cur))}
                disabled={!onSelect}
                style={!onSelect ? { cursor: "default" } : undefined}
              >
                <span className="dv-hbar-label" title={row.name}>{row.name}</span>
                <span className="dv-hbar-track" aria-hidden="true">
                  <span className="dv-count-bar" style={{ width }} />
                </span>
                <span className="dv-hbar-value">{row.value}{unit ? ` ${unit}` : ""}</span>
                <span className="dv-hbar-meta muted">{row.meta || valueLabel}</span>
              </button>
              {tip === row.name ? (
                <div role="tooltip" id={tipId} className="dv-tooltip">
                  <strong>{row.name}</strong>
                  <span>{valueLabel}: {row.value}{unit ? ` ${unit}` : ""}</span>
                  {row.meta ? <span>{row.meta}</span> : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {list.length > limit && !expanded ? (
        <button type="button" className="ghost" onClick={() => setExpanded(true)}>
          Xem thêm ({list.length - limit} nhóm)
        </button>
      ) : null}
      {expanded && list.length > limit ? (
        <button type="button" className="ghost" onClick={() => setExpanded(false)}>Thu gọn top {limit}</button>
      ) : null}
    </ChartShell>
  );
}
