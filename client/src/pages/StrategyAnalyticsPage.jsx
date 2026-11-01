import { useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";

const FIXTURE = {
  trades: [
    { profit: 10, closeTime: "2024-01-02", typeSignal: "A", symbol: "BTCUSDT", side: "LONG", entryPrice: 100, maxPrice: 110, minPrice: 95, initialPlannedRisk: 5 },
    { profit: -4, closeTime: "2024-01-03", typeSignal: "A", symbol: "BTCUSDT", side: "LONG", entryPrice: 100, maxPrice: 102, minPrice: 90, initialPlannedRisk: 5 },
    { profit: 8, closeTime: "2024-01-04", typeSignal: "B", symbol: "ETHUSDT", side: "SHORT", entryPrice: 50, maxPrice: 52, minPrice: 45, initialPlannedRisk: 4 },
  ],
  startingEquity: 1000,
  minSample: 20,
};

export default function StrategyAnalyticsPage() {
  const { user } = useAuth();
  const can = (user?.permissions || []).includes("statistics.view");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  async function runFixture() {
    try {
      const res = await api("/api/analytics/strategies/compute", { method: "POST", body: FIXTURE });
      setData(res);
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  if (!can) return <p className="muted">Cần statistics.view.</p>;

  const m = data?.summary?.metrics;
  const alerts = data?.alerts?.alerts || [];

  return (
    <section className="stack">
      <header>
        <h1>Strategy analytics</h1>
        <p className="muted">
          Cùng basis Reports (observed static profit). Ranking không dùng vài lệnh thắng làm edge.
          Alert không tắt config.
        </p>
      </header>
      <button type="button" onClick={runFixture}>Compute fixture</button>
      {error ? <p className="form-error">{error}</p> : null}
      {m ? (
        <ul>
          <li>Net PnL: {m.netPnL}</li>
          <li>WR: {m.winRate}% · Exp: {m.expectancy} · PF: {m.profitFactor ?? m.profitFactorLabel}</li>
          <li>R avg: {m.expectancyR ?? "unknown"} · DD: {m.maxDrawdown}</li>
          <li>Sharpe: {m.sharpe ?? "—"} · Sortino: {m.sortino ?? "—"}</li>
          <li>MAE/MFE avg: {m.maeAvg ?? "—"} / {m.mfeAvg ?? "—"} ({m.excursionFidelity?.note || "ok"})</li>
          <li>Edge claim: {String(data.summary.sample.edgeClaimAllowed)}</li>
        </ul>
      ) : null}
      {alerts.length ? (
        <div>
          <h2>Alerts</h2>
          <ul>
            {alerts.map((a) => (
              <li key={a.id}>{a.severity}: {a.title} (sideEffect={a.sideEffect || "none"})</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
