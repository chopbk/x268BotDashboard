import { useId, useState } from "react";
import { money, moneyShort, pct, toneClass } from "./format.js";
import { rankGroups, summarizeTop } from "./rankGroups.js";
import ChartShell from "./ChartShell.jsx";

const MODES = [
  { id: "abs", label: "|PnL| lớn nhất" },
  { id: "gain", label: "Lãi nhiều nhất" },
  { id: "loss", label: "Lỗ nhiều nhất" },
];

/**
 * Bar ngang PnL âm/dương quanh 0.
 * onSelect(name) — Enter/Space/click; Escape đóng tooltip.
 */
export default function HorizontalPnlBars({
  title,
  subtitle,
  rows,
  nameKey = "signal",
  selected = "",
  onSelect,
  limit = 10,
  loading = false,
  error = "",
  empty = "",
  lowSampleThreshold = 20,
}) {
  const tipId = useId();
  const [mode, setMode] = useState("abs");
  const [tip, setTip] = useState(null);
  const [expanded, setExpanded] = useState(false);

  const ranked = rankGroups(rows, { nameKey, limit: expanded ? 50 : limit, mode });
  const summary = summarizeTop(ranked);

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

  const dataColumns = [
    { key: "name", label: "Nhóm" },
    { key: "profit", label: "PnL", num: true, render: (row) => moneyShort(row.profit), tone: (row) => toneClass(row.profit) },
    { key: "count", label: "Lệnh", num: true },
    { key: "winRate", label: "Win rate", num: true, render: (row) => pct(row.winRate) },
  ];

  return (
    <ChartShell
      title={title}
      subtitle={subtitle}
      summary={ranked.shown.length ? summary : ""}
      loading={loading}
      error={error}
      empty={!loading && !error && !ranked.shown.length ? (empty || "Không có nhóm có PnL để vẽ.") : ""}
      actions={(
        <div className="dv-mode-tabs" role="group" aria-label="Cách xếp nhóm">
          {MODES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={mode === item.id ? "active" : "ghost"}
              aria-pressed={mode === item.id}
              onClick={() => setMode(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      dataRows={ranked.shown}
      dataColumns={dataColumns}
      height="rank"
    >
      <p className="muted dv-rank-meta">
        Top {ranked.shownCount}/{ranked.totalGroups} nhóm
        {mode === "abs" ? " theo trị tuyệt đối PnL — không gọi là top hiệu suất" : ""}
        {ranked.restCount ? ` · phần còn lại lãi ${moneyShort(ranked.restGain)}, lỗ ${moneyShort(ranked.restLoss)}` : ""}
      </p>
      <ul className="dv-hbar-list" role="list">
        {ranked.shown.map((row) => {
          const width = `${Math.max(2, (Math.abs(row.profit || 0) / ranked.maxAbs) * 50)}%`;
          const side = (row.profit || 0) >= 0 ? "pos" : "neg";
          const active = selected === row.name;
          const low = row.count > 0 && row.count < lowSampleThreshold;
          return (
            <li key={row.id} className={`dv-hbar-row${active ? " active" : ""}`}>
              <button
                type="button"
                className="dv-hbar-hit"
                aria-pressed={active}
                aria-describedby={tip === row.name ? tipId : undefined}
                aria-label={`${row.name}: PnL ${money(row.profit)}, ${row.count} lệnh, win rate ${pct(row.winRate)}`}
                onClick={() => pick(row.name)}
                onKeyDown={(event) => onKey(event, row.name)}
                onFocus={() => setTip(row.name)}
                onBlur={() => setTip((cur) => (cur === row.name ? null : cur))}
                onMouseEnter={() => setTip(row.name)}
                onMouseLeave={() => setTip((cur) => (cur === row.name ? null : cur))}
              >
                <span className="dv-hbar-label" title={row.name}>
                  {row.name}
                  {low ? <span className="dv-badge warn">Ít dữ liệu</span> : null}
                </span>
                <span className="dv-hbar-track" aria-hidden="true">
                  <span className="dv-hbar-zero" />
                  <span className={`dv-hbar-bar ${side}`} style={{ width, [side === "pos" ? "left" : "right"]: "50%" }} />
                </span>
                <span className={`dv-hbar-value ${toneClass(row.profit)}`}>{moneyShort(row.profit)}</span>
                <span className="dv-hbar-meta muted">{row.count} lệnh</span>
              </button>
              {tip === row.name ? (
                <div role="tooltip" id={tipId} className="dv-tooltip">
                  <strong>{row.name}</strong>
                  <span>PnL {money(row.profit)}</span>
                  <span>{row.count} lệnh · win rate {pct(row.winRate)}</span>
                  {row.wins != null || row.losses != null ? <span>Thắng/thua {row.wins}/{row.losses}</span> : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {ranked.totalGroups > limit && !expanded ? (
        <button type="button" className="ghost" onClick={() => setExpanded(true)}>
          Xem thêm ({ranked.totalGroups - limit} nhóm)
        </button>
      ) : null}
      {expanded && ranked.totalGroups > limit ? (
        <button type="button" className="ghost" onClick={() => setExpanded(false)}>Thu gọn top {limit}</button>
      ) : null}
    </ChartShell>
  );
}
