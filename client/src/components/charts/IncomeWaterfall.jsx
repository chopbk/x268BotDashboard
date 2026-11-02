import { useId, useState } from "react";
import { money, moneyShort, toneClass } from "./format.js";
import ChartShell from "./ChartShell.jsx";

const TRADING_STEPS = [
  { key: "realizedPnl", label: "Realized PnL", source: "REALIZED_PNL" },
  { key: "fee", label: "Commission", source: "COMMISSION" },
  { key: "funding", label: "Funding", source: "FUNDING_FEE" },
  { key: "rebate", label: "Rebate / fee return", source: "rebate types" },
];

const CASH_STEPS = [
  { key: "cashIn", label: "Nạp / chuyển vào", source: "cashIn (không tách transfer con)" },
  { key: "cashOut", label: "Rút / chuyển ra", source: "cashOut (không tách transfer con)" },
];

/**
 * Waterfall income — Trading chỉ hiện khi backend waterfallEligible.
 * Cash tách chế độ, không cộng transfer con với tổng cha.
 */
export default function IncomeWaterfall({
  title,
  subtitle,
  breakdown = null,
  from = "",
  to = "",
  loading = false,
  error = "",
}) {
  const tipId = useId();
  const [mode, setMode] = useState("trading");
  const [tip, setTip] = useState(null);

  const eligible = breakdown?.waterfallEligible === true && breakdown?.components;
  const cash = breakdown?.cashComponents;
  const hasCash = cash && ((Number(cash.cashIn) || 0) !== 0 || (Number(cash.cashOut) || 0) !== 0);
  const blockedNote = breakdown?.note
    || (breakdown?.coverage?.quality === "mixed" || breakdown?.coverage?.quality === "legacy"
      ? "Chưa đủ dữ liệu tách phí/funding cho toàn kỳ"
      : "");

  const showTrading = mode === "trading" && eligible;
  const showCash = mode === "cash" && hasCash;

  if (!eligible && !hasCash) {
    return (
      <ChartShell
        title={title}
        subtitle={subtitle}
        loading={loading}
        error={error}
        empty={blockedNote || "Waterfall ẩn — cần income typed đầy đủ và đối soát khớp trong kỳ."}
        height="rank"
      />
    );
  }

  const steps = showCash
    ? CASH_STEPS.map((step) => ({ ...step, value: Number(cash[step.key]) || 0 }))
    : showTrading
      ? TRADING_STEPS.map((step) => ({ ...step, value: Number(breakdown.components[step.key]) || 0 }))
      : [];

  const net = showCash
    ? (Number(cash.cashIn) || 0) + (Number(cash.cashOut) || 0)
    : Number(breakdown?.components?.netTrading) || 0;

  const coverage = breakdown?.coverage;
  const summary = showCash
    ? `Dòng tiền ròng ${money(net)} · không gồm trading/uPnL`
    : showTrading
      ? `Net trading ${money(net)} · typed ${coverage?.typedDays ?? "—"}/${coverage?.totalDays ?? "—"} ngày · đã đối soát`
      : blockedNote;

  let running = 0;
  const bridges = steps.map((step) => {
    running += step.value;
    return { ...step, running };
  });
  const maxAbs = Math.max(1, ...bridges.map((s) => Math.abs(s.value)), Math.abs(net));

  const dataRows = [
    ...bridges.map((row) => ({ id: row.key, name: row.label, value: row.value, source: row.source })),
    { id: "net", name: showCash ? "Dòng tiền ròng" : "Net trading", value: net, source: "tổng thành phần" },
  ];

  return (
    <ChartShell
      title={title}
      subtitle={subtitle || `${from} → ${to} UTC · USDT · thành phần loại trừ lẫn nhau`}
      summary={summary}
      loading={loading}
      error={error}
      empty={!showTrading && !showCash ? (mode === "cash" ? "Chưa có nạp/rút/chuyển trong kỳ." : (blockedNote || "Chế độ Trading cần typed đầy đủ.")) : ""}
      actions={(
        <div className="dv-mode-tabs" role="group" aria-label="Chế độ waterfall">
          <button type="button" className={mode === "trading" ? "active" : "ghost"} aria-pressed={mode === "trading"} disabled={!eligible} onClick={() => setMode("trading")}>
            Trading
          </button>
          <button type="button" className={mode === "cash" ? "active" : "ghost"} aria-pressed={mode === "cash"} disabled={!hasCash} onClick={() => setMode("cash")}>
            Dòng tiền
          </button>
        </div>
      )}
      dataRows={(showTrading || showCash) ? dataRows : null}
      dataColumns={[
        { key: "name", label: "Thành phần" },
        { key: "value", label: "USDT", num: true, render: (row) => moneyShort(row.value), tone: (row) => toneClass(row.value) },
        { key: "source", label: "Nguồn" },
      ]}
      height="rank"
    >
      {(showTrading || showCash) ? (
        <ul className="dv-waterfall" role="list">
          {bridges.map((row) => {
            const width = `${Math.max(2, (Math.abs(row.value) / maxAbs) * 50)}%`;
            const side = row.value >= 0 ? "pos" : "neg";
            return (
              <li key={row.key} className="dv-waterfall-row">
                <button
                  type="button"
                  className="dv-waterfall-hit"
                  aria-describedby={tip === row.key ? tipId : undefined}
                  aria-label={`${row.label}: ${money(row.value)}, cộng dồn ${money(row.running)}, nguồn ${row.source}`}
                  onMouseEnter={() => setTip(row.key)}
                  onMouseLeave={() => setTip((cur) => (cur === row.key ? null : cur))}
                  onFocus={() => setTip(row.key)}
                  onBlur={() => setTip((cur) => (cur === row.key ? null : cur))}
                >
                  <span className="dv-waterfall-label">{row.label}</span>
                  <span className="dv-waterfall-track" aria-hidden="true">
                    <span className="dv-hbar-zero" />
                    <span className={`dv-waterfall-bar ${side}`} style={{ width, [side === "pos" ? "left" : "right"]: "50%" }} />
                  </span>
                  <span className={`dv-waterfall-value ${toneClass(row.value)}`}>{moneyShort(row.value)}</span>
                  <span className="dv-waterfall-meta muted">Σ {moneyShort(row.running)}</span>
                </button>
                {tip === row.key ? (
                  <div role="tooltip" id={tipId} className="dv-tooltip">
                    <strong>{row.label}</strong>
                    <span>{money(row.value)}</span>
                    <span>Cộng dồn {money(row.running)}</span>
                    <span>Nguồn {row.source} · {from} → {to} UTC</span>
                  </div>
                ) : null}
              </li>
            );
          })}
          <li className="dv-waterfall-row net">
            <div className="dv-waterfall-hit" style={{ cursor: "default" }}>
              <span className="dv-waterfall-label">{showCash ? "Dòng tiền ròng" : "Net trading"}</span>
              <span className="dv-waterfall-track" aria-hidden="true">
                <span className="dv-hbar-zero" />
                <span
                  className={`dv-waterfall-bar net ${net >= 0 ? "pos" : "neg"}`}
                  style={{ width: `${Math.max(2, (Math.abs(net) / maxAbs) * 50)}%`, [net >= 0 ? "left" : "right"]: "50%" }}
                />
              </span>
              <span className={`dv-waterfall-value ${toneClass(net)}`}>{moneyShort(net)}</span>
              <span className="dv-waterfall-meta muted">tổng</span>
            </div>
          </li>
        </ul>
      ) : null}
    </ChartShell>
  );
}
