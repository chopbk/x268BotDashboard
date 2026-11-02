import { useId, useMemo, useState } from "react";
import { money, moneyShort, toneClass } from "./format.js";
import { buildCalendar, pnlLevel } from "./calendar.js";
import ChartShell from "./ChartShell.jsx";

export default function PnlCalendar({
  series,
  selectedDay = "",
  onSelectDay,
  loading = false,
  error = "",
  subtitle,
}) {
  const tipId = useId();
  const [tip, setTip] = useState(null);
  const cal = useMemo(() => buildCalendar(series), [series]);
  const rows = series || [];
  const total = rows.reduce((sum, row) => sum + (Number(row.profit) || 0), 0);
  const summary = rows.length
    ? `Kỳ ${rows[0]?.day} → ${rows[rows.length - 1]?.day} UTC · tổng PnL ngày ${moneyShort(total)}`
    : "";

  function pick(day, inRange) {
    if (!inRange || !onSelectDay) return;
    onSelectDay(selectedDay === day ? "" : day);
  }

  const dataColumns = [
    { key: "day", label: "Ngày UTC" },
    { key: "trades", label: "Lệnh", num: true },
    { key: "profit", label: "PnL", num: true, render: (row) => moneyShort(row.profit), tone: (row) => toneClass(row.profit) },
  ];

  return (
    <ChartShell
      title="Ngày nào lãi/lỗ nhiều nhất?"
      subtitle={subtitle || "Lịch PnL theo ngày đóng · USDT · UTC · ô trống trong kỳ = 0 lệnh"}
      summary={summary}
      loading={loading}
      error={error}
      empty={!loading && !error && !rows.length ? "Chưa có dữ liệu lịch trong kỳ." : ""}
      dataRows={rows}
      dataColumns={dataColumns}
    >
      <div className="dv-cal-scroll" aria-label="Lịch PnL theo tuần, cuộn ngang nếu cần">
        <div className="dv-cal" role="grid" aria-label="Lịch PnL UTC">
          <div className="dv-cal-head" role="row">
            {cal.weekdays.map((label) => (
              <span key={label} className="dv-cal-dow" role="columnheader">{label}</span>
            ))}
          </div>
          {cal.weeks.map((week, wi) => (
            <div key={`w-${wi}`} className="dv-cal-week" role="row">
              {week.map((cell) => {
                const level = cell.inRange ? pnlLevel(cell.profit, cal.maxAbs, cell.missing) : "out";
                const active = selectedDay === cell.day;
                return (
                  <button
                    key={cell.day}
                    type="button"
                    role="gridcell"
                    disabled={!cell.inRange}
                    className={`dv-cal-cell level-${level}${active ? " active" : ""}`}
                    aria-pressed={active}
                    aria-label={cell.inRange
                      ? `${cell.day} UTC: ${cell.missing ? "Thiếu dữ liệu" : `${money(cell.profit)}, ${cell.trades} lệnh`}`
                      : `${cell.day} ngoài kỳ`}
                    onClick={() => pick(cell.day, cell.inRange)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setTip(null);
                    }}
                    onFocus={() => setTip(cell.day)}
                    onBlur={() => setTip((cur) => (cur === cell.day ? null : cur))}
                    onMouseEnter={() => setTip(cell.day)}
                    onMouseLeave={() => setTip((cur) => (cur === cell.day ? null : cur))}
                  >
                    <span className="dv-cal-day">{cell.day.slice(8)}</span>
                    {cell.monthLabel ? <span className="dv-cal-month">{cell.monthLabel}</span> : null}
                    {cell.missing ? <span className="dv-cal-miss">Thiếu</span> : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      {tip ? (
        <div role="tooltip" id={tipId} className="dv-tooltip floating">
          {(() => {
            const cell = cal.cells.find((item) => item.day === tip);
            if (!cell || !cell.inRange) return <span>{tip}</span>;
            if (cell.missing) return <><strong>{cell.day} UTC</strong><span>Thiếu dữ liệu</span></>;
            return (
              <>
                <strong>{cell.day} UTC</strong>
                <span>PnL {money(cell.profit)}</span>
                <span>{cell.trades} lệnh{cell.wins != null ? ` · thắng/thua ${cell.wins}/${cell.losses}` : ""}</span>
              </>
            );
          })()}
        </div>
      ) : null}
      <div className="dv-cal-legend" aria-hidden="true">
        <span className="muted">Lỗ</span>
        {[5, 4, 3, 2, 1].map((n) => <span key={`n${n}`} className={`dv-cal-swatch level-neg-${n}`} />)}
        <span className="dv-cal-swatch level-zero" />
        {[1, 2, 3, 4, 5].map((n) => <span key={`p${n}`} className={`dv-cal-swatch level-pos-${n}`} />)}
        <span className="muted">Lãi</span>
        <span className="dv-cal-swatch level-missing" title="Thiếu dữ liệu" />
        <span className="muted">Thiếu dữ liệu</span>
      </div>
    </ChartShell>
  );
}
