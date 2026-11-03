import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";

const FIXTURE = {
  trades: [
    { profit: 10, closeTime: "2024-01-02", typeSignal: "A", symbol: "BTCUSDT", side: "LONG", entryPrice: 100, maxPrice: 110, minPrice: 95, initialPlannedRisk: 5 },
    { profit: -4, closeTime: "2024-01-03", typeSignal: "A", symbol: "BTCUSDT", side: "LONG", entryPrice: 100, maxPrice: 102, minPrice: 90, initialPlannedRisk: 5 },
    { profit: 8, closeTime: "2024-01-04", typeSignal: "B", symbol: "ETHUSDT", side: "SHORT", entryPrice: 50, maxPrice: 52, minPrice: 45, initialPlannedRisk: 4 },
    { profit: 6, closeTime: "2024-01-05", typeSignal: "A", symbol: "BTCUSDT", side: "LONG", entryPrice: 105, maxPrice: 112, minPrice: 100, initialPlannedRisk: 5 },
    { profit: -3, closeTime: "2024-01-06", typeSignal: "B", symbol: "ETHUSDT", side: "SHORT", entryPrice: 48, maxPrice: 50, minPrice: 44, initialPlannedRisk: 4 },
  ],
  startingEquity: 1000,
  minSample: 5,
};

const SOURCE_COPY = {
  ok: "Đã tải đủ lệnh trong phạm vi.",
  no_trades: "Không có lệnh đóng trong kỳ — không suy edge từ khoảng trống.",
  empty_scope: "Account không có env trong phạm vi của bạn.",
  truncated: "Tập lệnh bị cắt theo cap — số liệu mang tính quan sát, không khẳng định edge toàn kỳ.",
  load_failed: "Không tải được account_statics.",
  fixture: "Fixture offline — không phải dữ liệu account thật.",
};

function fmt(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function tone(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "";
  return n > 0 ? "positive" : "negative";
}

function sourceBanner(data) {
  if (!data?.sourceStatus) return null;
  const status = data.truncated ? "truncated" : data.sourceStatus;
  return SOURCE_COPY[status] || `source=${data.sourceStatus}`;
}

async function loadAccountChoices() {
  const names = new Set();
  try {
    let page = 1;
    let total = Infinity;
    while (names.size < total && page <= 10) {
      const data = await api(`/api/bots?active=true&page=${page}&limit=100`);
      for (const bot of data.bots || []) {
        if (bot?.username) names.add(bot.username);
      }
      total = Number(data.total) || names.size;
      if (!(data.bots || []).length) break;
      page += 1;
    }
  } catch {
    // statistics.view không luôn kèm bots.view — fallback Static.
  }
  if (!names.size) {
    try {
      const data = await api("/api/account-statics?username=__all__&scope=mine&range=30&book=live&closed=closed&analytics=1&limit=1");
      for (const name of data.usernames || []) names.add(name);
    } catch {
      // keep empty
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

function Kpi({ label, value, note, toneClass }) {
  return (
    <article className={`card sa-kpi ${toneClass || ""}`}>
      <span className="sa-kpi-label">{label}</span>
      <strong className="sa-kpi-value">{value}</strong>
      {note ? <small className="muted">{note}</small> : null}
    </article>
  );
}

function BreakdownTable({ title, rows }) {
  if (!rows?.length) return null;
  return (
    <div className="card sa-breakdown">
      <h3>{title}</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Nhóm</th>
              <th className="num">N</th>
              <th className="num">Net</th>
              <th className="num">WR%</th>
              <th className="num">PF</th>
              <th className="num">Exp</th>
              <th>Edge?</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td>{row.key}</td>
                <td className="num">{row.valid ?? "—"}</td>
                <td className={`num ${tone(row.netPnL)}`}>{fmt(row.netPnL)}</td>
                <td className="num">{row.winRate == null ? "—" : fmt(row.winRate, 1)}</td>
                <td className="num">{row.profitFactor == null ? "—" : fmt(row.profitFactor, 2)}</td>
                <td className={`num ${tone(row.expectancy)}`}>{fmt(row.expectancy)}</td>
                <td>{row.edgeClaimAllowed ? "đủ mẫu" : "chưa"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function StrategyAnalyticsPage() {
  const { user } = useAuth();
  const can = (user?.permissions || []).includes("statistics.view");
  const location = useLocation();
  const navigate = useNavigate();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);

  const account = params.get("username") || "";
  const range = params.get("range") || "30";
  const book = params.get("book") || "live";

  const [accounts, setAccounts] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [boot, setBoot] = useState(true);

  function setQuery(patch, { replace = false } = {}) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value == null || value === "") next.delete(key);
      else next.set(key, String(value));
    }
    const search = next.toString();
    navigate({ pathname: "/analytics", search: search ? `?${search}` : "" }, { replace });
  }

  const loadAccount = useCallback(async (username, opts = {}) => {
    const target = String(username || "").trim();
    if (!target) {
      setError("Chọn tài khoản bot");
      return;
    }
    setBusy(true);
    try {
      const q = new URLSearchParams({
        username: target,
        range: opts.range || range,
        book: opts.book || book,
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
  }, [book, range]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await loadAccountChoices();
        if (cancelled) return;
        setAccounts(list);
        if (!account && list[0]) {
          setQuery({ username: list[0], range, book }, { replace: true });
        }
      } catch (err) {
        if (!cancelled) setError(err.message || "Không tải danh sách account");
      } finally {
        if (!cancelled) setBoot(false);
      }
    })();
    return () => { cancelled = true; };
    // chỉ boot một lần
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (boot) return;
    if (!account) return;
    loadAccount(account);
  }, [account, range, book, boot, loadAccount]);

  async function runFixture() {
    setBusy(true);
    try {
      const res = await api("/api/analytics/strategies/compute", { method: "POST", body: FIXTURE });
      setData({ ...res, sourceStatus: "fixture", tradeCount: FIXTURE.trades.length });
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!can) return <p className="muted">Cần statistics.view.</p>;

  const m = data?.summary?.metrics;
  const sample = data?.summary?.sample;
  const alerts = data?.alerts?.alerts || [];
  const banner = sourceBanner(data);
  const breakdown = data?.breakdown || {};

  return (
    <section className="stack sa-page">
      <header className="sa-header">
        <div>
          <h1>Strategy analytics</h1>
          <p className="muted">
            Basis observed static profit (cùng Reports). Mẫu nhỏ không được coi là bằng chứng edge;
            alert chỉ phân tích — không tắt config.
          </p>
        </div>
        <div className="sa-header-links">
          <Link className="ghost link-btn" to="/reports?tab=performance&range=30&analytics=1">Báo cáo</Link>
          {account ? (
            <Link className="ghost link-btn" to={`/terminal?account=${encodeURIComponent(account)}`}>Terminal</Link>
          ) : null}
        </div>
      </header>

      <div className="card sa-controls">
        <label>
          Account
          {accounts.length ? (
            <select
              value={account}
              disabled={busy}
              onChange={(e) => setQuery({ username: e.target.value })}
            >
              {!account ? <option value="">— chọn —</option> : null}
              {accounts.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          ) : (
            <input
              value={account}
              disabled={busy || boot}
              onChange={(e) => setQuery({ username: e.target.value.trim() })}
              placeholder="bot username"
            />
          )}
        </label>
        <label>
          Kỳ
          <select value={range} disabled={busy} onChange={(e) => setQuery({ range: e.target.value })}>
            <option value="7">7 ngày</option>
            <option value="30">30 ngày</option>
            <option value="90">90 ngày</option>
          </select>
        </label>
        <label>
          Sổ
          <select value={book} disabled={busy} onChange={(e) => setQuery({ book: e.target.value })}>
            <option value="live">live</option>
            <option value="paper">paper</option>
            <option value="all">all</option>
          </select>
        </label>
        <div className="sa-control-actions">
          <button type="button" disabled={busy || !account} onClick={() => loadAccount(account)}>
            {busy ? "Đang tải…" : "Tải lại"}
          </button>
          <button type="button" className="ghost" disabled={busy} onClick={runFixture}>
            Compute fixture
          </button>
        </div>
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      {banner ? (
        <p className={`sa-banner ${data?.sourceStatus === "ok" && !data?.truncated ? "ok" : "warn"}`}>
          {banner}
          {data?.tradeCount != null ? ` · trades=${data.tradeCount}` : ""}
          {data?.truncated ? ` · cap=${data.cap}` : ""}
          {sample ? ` · valid=${sample.valid}/${sample.trades}` : ""}
        </p>
      ) : null}

      {m ? (
        <>
          <div className="sa-kpi-grid">
            <Kpi label="Net PnL" value={fmt(m.netPnL)} toneClass={tone(m.netPnL)} note={data?.summary?.accountingBasis || ""} />
            <Kpi
              label="Win rate"
              value={m.winRate == null ? "—" : `${fmt(m.winRate, 1)}%`}
              note={sample ? `${sample.wins}W / ${sample.losses}L` : null}
            />
            <Kpi
              label="Profit factor"
              value={m.profitFactorLabel || (m.profitFactor == null ? "—" : fmt(m.profitFactor, 2))}
              note={sample?.edgeClaimAllowed ? "đủ mẫu để đọc PF" : "chưa đủ mẫu / PF undefined"}
            />
            <Kpi label="Expectancy" value={fmt(m.expectancy)} toneClass={tone(m.expectancy)} note={`R avg ${m.expectancyR ?? "—"}`} />
            <Kpi label="Max DD" value={fmt(m.maxDrawdown)} note={m.maxDrawdownCashflowAdjusted ? "có điều chỉnh cashflow" : "từ equity lệnh"} />
            <Kpi label="Sharpe / Sortino" value={`${m.sharpe ?? "—"} / ${m.sortino ?? "—"}`} note="theo series ngày" />
            <Kpi
              label="MAE / MFE avg"
              value={`${m.maeAvg ?? "—"} / ${m.mfeAvg ?? "—"}`}
              note={m.excursionFidelity?.note || "đường giá đầy đủ"}
            />
            <Kpi
              label="Edge claim"
              value={sample?.edgeClaimAllowed ? "allowed" : "blocked"}
              note={sample?.note || `minSample=${sample?.minSample ?? 20}`}
            />
          </div>

          {alerts.length ? (
            <div className="card sa-alerts">
              <h2>Alerts phân tích</h2>
              <p className="muted">sideEffect=none — không tự đổi config / tắt bot.</p>
              <ul>
                {alerts.map((a) => (
                  <li key={a.id}>
                    <strong>{a.severity}</strong> · {a.title}
                    {a.detail ? <span className="muted"> — {a.detail}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="sa-breakdowns">
            <BreakdownTable title="Theo signal" rows={breakdown.signal} />
            <BreakdownTable title="Theo symbol" rows={breakdown.symbol} />
            <BreakdownTable title="Theo env" rows={breakdown.env} />
          </div>
        </>
      ) : (
        !busy && !error && !boot ? (
          <p className="muted">Chọn account để xem metrics chiến lược.</p>
        ) : null
      )}
    </section>
  );
}
