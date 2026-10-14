import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const text = n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n > 0 ? "+" : ""}${text}$`.replace("+-", "-");
}

function plain(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function tone(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "";
  return n > 0 ? "positive" : "negative";
}

const COLORS = ["var(--accent)", "var(--ok)", "var(--warn, #e0a106)", "#6ea8fe", "#c084fc", "#f472b6"];

function multiLinePoints(seriesList, width, height) {
  const all = seriesList.flatMap((item) => (item.series || []).map((row) => Number(row.cumulative) || 0));
  const min = all.length ? Math.min(0, ...all) : 0;
  const max = all.length ? Math.max(0, ...all) : 1;
  const span = max - min || 1;
  const days = [...new Set(seriesList.flatMap((item) => (item.series || []).map((row) => row.day)))].sort();
  if (days.length < 2) return { lines: [], days, min, max };

  return {
    days,
    min,
    max,
    lines: seriesList.map((item, index) => {
      const byDay = new Map((item.series || []).map((row) => [row.day, Number(row.cumulative) || 0]));
      let last = 0;
      const pts = days.map((day, i) => {
        if (byDay.has(day)) last = byDay.get(day);
        const x = 12 + (i * (width - 24)) / Math.max(days.length - 1, 1);
        const y = height - 12 - ((last - min) * (height - 24)) / span;
        return `${x},${y}`;
      }).join(" ");
      return { name: item.name, color: COLORS[index % COLORS.length], points: pts, profit: item.profit };
    }),
  };
}

function MetricCard({ label, value, note, tip, toneClass }) {
  return (
    <article className={`card summary-stat ${toneClass || ""}`} title={tip || undefined}>
      <small>{label}</small>
      <strong>{value}</strong>
      {note ? <span className="muted" style={{ fontSize: "0.78rem" }}>{note}</span> : null}
    </article>
  );
}

function GroupTable({ title, rows, nameLabel, username, nameParam }) {
  if (!rows?.length) return <p className="muted">Chưa có nhóm {nameLabel.toLowerCase()} trong kỳ.</p>;
  return (
    <div className="compare-block">
      <h3 className="summary-section-title" style={{ fontSize: "1rem" }}>{title}</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{nameLabel}</th>
              <th>Lệnh</th>
              <th>WR</th>
              <th>PnL</th>
              <th>PF</th>
              <th>Expectancy</th>
              <th>Max DD</th>
              <th>Giữ lệnh</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 20).map((row) => (
              <tr key={row.name}>
                <td>
                  {username && nameParam ? (
                    <Link className="trail-link" to={`/signals?view=statics&username=${encodeURIComponent(username)}&${nameParam}=${encodeURIComponent(row.name)}`}>
                      {row.name}
                    </Link>
                  ) : row.name}
                </td>
                <td>{row.wins}/{row.valid}</td>
                <td>{plain(row.winRate, 1)}%</td>
                <td className={tone(row.profit)}>{money(row.profit)}</td>
                <td>{row.profitFactorLabel || (row.profitFactor == null ? "—" : plain(row.profitFactor))}</td>
                <td className={tone(row.expectancy)}>{money(row.expectancy)}</td>
                <td className="negative">{row.maxDrawdown == null ? "—" : `${plain(row.maxDrawdown)}$`}</td>
                <td>{row.avgHoldLabel || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function LedgerAttribution({ attribution, username }) {
  const [curveMode, setCurveMode] = useState("account");
  const attr = attribution;
  const metrics = attr?.account?.metrics || {};
  const chartPack = useMemo(() => {
    if (!attr?.account) return { lines: [], days: [] };
    if (curveMode === "signal") {
      return multiLinePoints(attr.topCurves?.signal || [], 640, 200);
    }
    if (curveMode === "strategy") {
      return multiLinePoints(attr.topCurves?.strategy || [], 640, 200);
    }
    return multiLinePoints([{ name: username || "Account", series: attr.account.series || [], profit: metrics.profit }], 640, 200);
  }, [attr, curveMode, username, metrics.profit]);

  if (!attr?.account) return null;
  const fq = attr.fillQuality || {};

  return (
    <section className="ledger-attribution">
      <h2 className="summary-section-title">Attribution & equity</h2>
      <p className="muted">
        Equity curve từ lệnh Account Static (live, đã đóng) trong cùng kỳ UTC — bắt đầu từ 0, không phải số dư ví.
        {attr.truncated ? " Đã cắt tối đa 2000 lệnh gần nhất trong kỳ." : ""}
        {" "}Max DD / PF / expectancy / time-in-trade tính trên tập lệnh đó.
      </p>

      <div className="stats-grid summary-grid">
        <MetricCard label="Max drawdown" value={metrics.maxDrawdown == null ? "—" : `${plain(metrics.maxDrawdown)}$`} note={metrics.maxDrawdownPct != null ? `${plain(metrics.maxDrawdownPct, 1)}% đỉnh` : null} tip={attr.formulas?.maxDrawdown} toneClass="negative" />
        <MetricCard label="Profit factor" value={metrics.profitFactorLabel || (metrics.profitFactor == null ? "—" : plain(metrics.profitFactor))} tip={attr.formulas?.profitFactor} />
        <MetricCard label="Expectancy / lệnh" value={money(metrics.expectancy)} tip={attr.formulas?.expectancy} toneClass={tone(metrics.expectancy)} />
        <MetricCard label="Time-in-trade TB" value={metrics.avgHoldLabel || "—"} tip={attr.formulas?.timeInTrade} />
        <MetricCard label="Win rate lệnh" value={metrics.winRate == null ? "—" : `${plain(metrics.winRate, 1)}%`} note={`${metrics.wins || 0}W / ${metrics.losses || 0}L · ${metrics.valid || 0} lệnh`} />
        <MetricCard label="PnL attribution" value={money(metrics.profit)} tip={attr.formulas?.equity} toneClass={tone(metrics.profit)} />
      </div>

      <div className="ledger-tools" style={{ marginBottom: 8 }}>
        <span className="muted">Equity curve</span>
        {[
          ["account", "Account"],
          ["signal", "Signal"],
          ["strategy", "Config / strategy"],
        ].map(([id, label]) => (
          <button key={id} type="button" className={curveMode === id ? "active" : "ghost"} onClick={() => setCurveMode(id)}>{label}</button>
        ))}
      </div>
      {chartPack.lines.length === 0 || (chartPack.days || []).length < 2 ? (
        <p className="muted">Chưa đủ lệnh đóng để vẽ equity.</p>
      ) : (
        <>
          <svg className="ledger-chart ledger-equity-chart" viewBox="0 0 640 200" role="img" aria-label="Equity curve">
            {chartPack.lines.map((line) => (
              <polyline key={line.name} fill="none" stroke={line.color} strokeWidth="2" points={line.points}>
                <title>{`${line.name}: ${money(line.profit)}`}</title>
              </polyline>
            ))}
          </svg>
          {curveMode !== "account" ? (
            <p className="ledger-legend">
              {chartPack.lines.map((line) => (
                <span key={line.name} style={{ color: line.color }}>{line.name}</span>
              ))}
            </p>
          ) : null}
        </>
      )}

      <GroupTable title="Theo signal" rows={attr.bySignal} nameLabel="Signal" username={username} nameParam="signal" />
      <GroupTable title="Theo config / strategy" rows={attr.byStrategy} nameLabel="Config" username={username} nameParam="env" />

      <h3 className="summary-section-title" style={{ fontSize: "1rem" }}>Slippage & fill quality</h3>
      <p className="muted">{fq.note || attr.formulas?.slippage}</p>
      <div className="stats-grid">
        <MetricCard label="Limit fill" value={fq.limitRate == null ? "—" : `${plain(fq.limitRate, 1)}%`} note={`${fq.limitCount || 0} limit / ${fq.marketCount || 0} market`} />
        <MetricCard label="Copy" value={fq.copyRate == null ? "—" : `${plain(fq.copyRate, 1)}%`} note={`${fq.copyCount || 0} lệnh`} />
        <MetricCard label="Khớp giá signal" value={fq.matchRate == null ? "—" : `${plain(fq.matchRate, 1)}%`} note={`${fq.matchedSignalPrice || 0}/${fq.trades || 0}`} />
        <MetricCard label="Slippage TB" value={fq.avgSlippageBps == null ? "—" : `${plain(fq.avgSlippageBps, 1)} bps`} note={fq.avgAbsSlippageBps == null ? null : `|slip| ${plain(fq.avgAbsSlippageBps, 1)} bps`} tip={attr.formulas?.slippage} />
      </div>
      {fq.samples?.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Signal</th>
                <th>Side</th>
                <th>Entry</th>
                <th>Giá signal</th>
                <th>Slippage</th>
                <th>Nguồn</th>
              </tr>
            </thead>
            <tbody>
              {fq.samples.map((row, index) => (
                <tr key={`${row.symbol}-${index}`}>
                  <td>{row.symbol}</td>
                  <td>{row.signal}</td>
                  <td>{row.side}</td>
                  <td>{plain(row.entry, 4)}</td>
                  <td>{plain(row.signalPrice, 4)}</td>
                  <td className={tone(-Math.abs(row.slippageBps))}>{plain(row.slippageBps, 1)} bps</td>
                  <td>{row.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
