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
  const [account, setAccount] = useState("");
  const [range, setRange] = useState("30");
  const [book, setBook] = useState("live");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function runFixture() {
    setBusy(true);
    try {
      const res = await api("/api/analytics/strategies/compute", { method: "POST", body: FIXTURE });
      setData({ ...res, sourceStatus: "fixture" });
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function loadAccount() {
    if (!account.trim()) {
      setError("Nhập username tài khoản");
      return;
    }
    setBusy(true);
    try {
      const q = new URLSearchParams({
        username: account.trim(),
        range,
        book,
        minSample: "20",
      });
      const res = await api(`/api/analytics/strategies?${q}`);
      setData(res);
      setError("");
    } catch (err) {
      setData(null);
      setError(err.message || "Không tải được");
    } finally {
      setBusy(false);
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
          Basis Reports (observed static profit). Không dùng 1 trang 50 lệnh làm toàn bộ tập.
          Alert không tắt config. sourceStatus phân biệt no_trades / load_failed / truncated.
        </p>
      </header>
      <div className="stack" style={{ maxWidth: 480 }}>
        <label>
          Account
          <input value={account} onChange={(e) => setAccount(e.target.value)} placeholder="bot username" />
        </label>
        <label>
          Range
          <select value={range} onChange={(e) => setRange(e.target.value)}>
            <option value="7">7d</option>
            <option value="30">30d</option>
            <option value="90">90d</option>
          </select>
        </label>
        <label>
          Book
          <select value={book} onChange={(e) => setBook(e.target.value)}>
            <option value="live">live</option>
            <option value="paper">paper</option>
            <option value="all">all</option>
          </select>
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" disabled={busy} onClick={loadAccount}>Tải account</button>
          <button type="button" className="ghost" disabled={busy} onClick={runFixture}>Compute fixture</button>
        </div>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      {data?.sourceStatus ? (
        <p className="muted">
          source={data.sourceStatus}
          {data.truncated ? ` · truncated@${data.cap}` : ""}
          {data.tradeCount != null ? ` · trades=${data.tradeCount}` : ""}
        </p>
      ) : null}
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
