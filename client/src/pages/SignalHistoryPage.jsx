import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";

const can = (user, permission) => (user?.permissions || []).includes(permission);
const fmtTime = (value) => value ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value)) : "—";
const fmt = (value, digits = 2) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : "—";

export default function SignalHistoryPage() {
  const { user } = useAuth();
  const signalAllowed = can(user, "signals.history");
  const staticAllowed = can(user, "statistics.view");
  const [params, setParams] = useSearchParams();
  const [bots, setBots] = useState([]);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const requestedView = params.get("view") || "signals";
  const view = requestedView === "statics" && staticAllowed ? "statics" : signalAllowed ? "signals" : "statics";
  const username = params.get("username") || "";
  const env = params.get("env") || "";
  const q = params.get("q") || "";
  const side = params.get("side") || "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const selectedBot = useMemo(() => bots.find((bot) => bot.username === username), [bots, username]);

  function update(values) {
    const next = new URLSearchParams(params);
    Object.entries(values).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    if (!Object.hasOwn(values, "page")) next.set("page", "1");
    setParams(next);
  }

  useEffect(() => {
    api("/api/bots").then((result) => {
      const nextBots = result.bots || [];
      setBots(nextBots);
      if (!username && nextBots[0]) update({ username: nextBots[0].username });
    }).catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!username) { setLoading(false); return; }
    setLoading(true); setError(""); setData(null);
    const query = new URLSearchParams({ username, page: String(page), limit: "50" });
    if (env) query.set("env", env);
    if (q) query.set("q", q);
    if (side) query.set("side", side);
    const endpoint = view === "statics" ? "/api/account-statics" : "/api/signal-history";
    api(`${endpoint}?${query}`).then(setData).catch((err) => setError(err.message)).finally(() => setLoading(false));
  }, [username, env, q, side, page, view]);

  const signalStats = view === "signals" ? data?.stats : null;
  const tradeStats = view === "statics" ? data?.stats : null;
  return (
    <section>
      <header className="page-head"><div><h1>Lịch sử & thống kê</h1><p className="muted">Signal nhận được đọc từ Signal_Infos; hiệu suất giao dịch đọc từ Account_Static.</p></div></header>
      <div className="history-tabs">
        {signalAllowed ? <button className={view === "signals" ? "active" : "ghost"} onClick={() => update({ view: "signals" })}>Lịch sử signal</button> : null}
        {staticAllowed ? <button className={view === "statics" ? "active" : "ghost"} onClick={() => update({ view: "statics" })}>Account Static</button> : null}
      </div>
      <div className="card signal-filters">
        <label>User bot<select value={username} onChange={(e) => update({ username: e.target.value, env: "" })}>{bots.map((bot) => <option key={bot.username} value={bot.username}>{bot.username}</option>)}</select></label>
        <label>Account Config<select value={env} onChange={(e) => update({ env: e.target.value })}><option value="">Tất cả config</option>{(selectedBot?.accounts || []).map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
        <label>Symbol<input value={q} onChange={(e) => update({ q: e.target.value })} placeholder="BTCUSDT" /></label>
        <label>Side<select value={side} onChange={(e) => update({ side: e.target.value })}><option value="">Tất cả</option><option value="LONG">LONG</option><option value="SHORT">SHORT</option></select></label>
      </div>
      {signalStats ? <div className="stats-grid signal-stats"><article className="card"><span className="muted">Tổng signal</span><strong>{signalStats.total}</strong></article><article className="card"><span className="muted">LONG</span><strong>{signalStats.long}</strong></article><article className="card"><span className="muted">SHORT</span><strong>{signalStats.short}</strong></article></div> : null}
      {tradeStats ? <div className="stats-grid signal-stats"><article className="card"><span className="muted">Số lệnh</span><strong>{tradeStats.total}</strong></article><article className="card"><span className="muted">Win rate</span><strong>{fmt(tradeStats.winRate, 1)}%</strong></article><article className="card"><span className="muted">Profit</span><strong>{fmt(tradeStats.profit)}$</strong></article><article className="card"><span className="muted">Volume</span><strong>{fmt(tradeStats.volume)}$</strong></article></div> : null}
      {data?.stats?.bySignal?.length ? <div className="chips signal-chips">{data.stats.bySignal.map((item) => <span className="chip" key={item.signal}>{item.signal}: {item.count}{view === "statics" ? ` · ${fmt(item.profit)}$` : ""}</span>)}</div> : null}
      {loading ? <p className="muted">Đang tải…</p> : null}{error ? <p className="form-error">{error}</p> : null}
      {!loading && data?.rows?.length === 0 ? <div className="card empty">Không có dữ liệu phù hợp với config và bộ lọc.</div> : null}
      {view === "signals" && data?.rows?.length ? <div className="table-wrap signal-table"><table><thead><tr><th>Thời gian</th><th>Signal</th><th>Symbol</th><th>Side</th><th>Loại</th><th>Trạng thái</th></tr></thead><tbody>{data.rows.map((row) => <tr key={row.id}><td>{fmtTime(row.openTime)}</td><td>{row.signal}</td><td>{row.symbol}</td><td>{row.side}</td><td>{row.type}</td><td>{row.status}</td></tr>)}</tbody></table></div> : null}
      {view === "statics" && data?.rows?.length ? <div className="table-wrap signal-table"><table><thead><tr><th>Thời gian</th><th>Config</th><th>Signal</th><th>Symbol</th><th>Side</th><th>Status</th><th>Profit</th><th>ROE</th></tr></thead><tbody>{data.rows.map((row) => <tr key={row.id}><td>{fmtTime(row.openTime)}</td><td>{row.env}</td><td>{row.signal}</td><td>{row.symbol}</td><td>{row.side}</td><td>{row.status}</td><td>{fmt(row.profit)}$</td><td>{fmt(row.roe)}%</td></tr>)}</tbody></table></div> : null}
      {data?.total > data?.limit ? <div className="audit-pagination"><span className="muted">Trang {data.page} · {data.total} bản ghi</span><div><button className="ghost" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>Trước</button><button className="ghost" disabled={page * data.limit >= data.total} onClick={() => update({ page: String(page + 1) })}>Sau</button></div></div> : null}
      {username ? <p className="muted"><Link to={`/bots/${encodeURIComponent(username)}`}>Mở User bot {username}</Link></p> : null}
    </section>
  );
}
