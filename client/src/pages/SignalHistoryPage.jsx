import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import useDebouncedValue from "../hooks/useDebouncedValue";
import { useAuth } from "../auth";

const can = (user, permission) => (user?.permissions || []).includes(permission);
const fmtTime = (value) => value ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value)) : "—";
const fmt = (value, digits = 2) => value == null || value === "" || !Number.isFinite(Number(value)) ? "—" : Number(value).toFixed(digits);
const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days) {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

function toLocalInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function applyDatePick(currentIso, localValue) {
  if (!localValue) return "";
  const next = new Date(localValue);
  if (Number.isNaN(next.getTime())) return "";
  const prev = currentIso ? new Date(currentIso) : null;
  const sameDay = prev && !Number.isNaN(prev.getTime())
    && prev.getFullYear() === next.getFullYear()
    && prev.getMonth() === next.getMonth()
    && prev.getDate() === next.getDate();
  if (!sameDay) next.setHours(0, 0, 0, 0);
  else next.setMinutes(0, 0, 0);
  return next.toISOString();
}

function DetailItem({ label, value }) {
  return <div><dt>{label}</dt><dd>{value ?? "—"}</dd></div>;
}

function TradeDetail({ row, onClose }) {
  return (
    <article className="card trade-detail">
      <header>
        <h2>{row.symbol || "Giao dịch"} · {row.side || "—"}</h2>
        <button type="button" className="ghost" onClick={onClose}>Đóng</button>
      </header>
      <dl>
        <DetailItem label="Config" value={row.env} />
        <DetailItem label="Signal" value={row.signal} />
        <DetailItem label="Status" value={row.status} />
        <DetailItem label="Profit" value={`${fmt(row.profit)} $`} />
        <DetailItem label="ROE" value={`${fmt(row.roe)} %`} />
        <DetailItem label="Volume" value={`${fmt(row.volume)} $`} />
        <DetailItem label="Giá vào" value={fmt(row.entryPrice)} />
        <DetailItem label="Giá đóng" value={fmt(row.closePrice)} />
        <DetailItem label="Đòn bẩy" value={fmt(row.leverage, 0)} />
        <DetailItem label="Cost" value={fmt(row.cost)} />
        <DetailItem label="Khối lượng" value={fmt(row.positionAmt, 4)} />
        <DetailItem label="Mở" value={fmtTime(row.openTime)} />
        <DetailItem label="Đóng" value={fmtTime(row.closeTime)} />
        <DetailItem label="TP" value={row.tps?.length ? row.tps.map((price) => fmt(price)).join(", ") : "—"} />
        <DetailItem label="Copy" value={row.copy ? "Có" : "Không"} />
        <DetailItem label="Limit" value={row.limit ? "Có" : "Không"} />
        <DetailItem label="Paper" value={row.paper ? "Có" : "Không"} />
        <DetailItem label="Đã đóng" value={row.closed ? "Có" : "Không"} />
      </dl>
    </article>
  );
}

export default function SignalHistoryPage() {
  const { user } = useAuth();
  const signalAllowed = can(user, "signals.history");
  const staticAllowed = can(user, "statistics.view");
  const [params, setParams] = useSearchParams();
  const [bots, setBots] = useState([]);
  const [data, setData] = useState(null);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const requestedView = params.get("view");
  const view = requestedView === "signals" && signalAllowed ? "signals" : requestedView === "statics" && staticAllowed ? "statics" : staticAllowed ? "statics" : "signals";
  const username = params.get("username") || "";
  const env = params.get("env") || "";
  const q = params.get("q") || "";
  const side = params.get("side") || "";
  const signal = params.get("signal") || "";
  const status = params.get("status") || "";
  const profit = params.get("profit") || "";
  const trade = params.get("trade") || "";
  const [fallbackFrom] = useState(() => daysAgo(3));
  const from = params.get("from") || "";
  const to = params.get("to") || "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const selectedBot = useMemo(() => bots.find((bot) => bot.username === username), [bots, username]);
  const activeFrom = from || fallbackFrom;
  const debouncedQ = useDebouncedValue(q);

  function update(values) {
    const next = new URLSearchParams(params);
    Object.entries(values).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    if (!Object.hasOwn(values, "page") && !Object.hasOwn(values, "trade")) next.set("page", "1");
    setParams(next);
  }

  useEffect(() => {
    if (view !== "statics") return undefined;
    let cancelled = false;
    api("/api/bots").then((result) => {
      if (cancelled) return;
      const nextBots = result.bots || [];
      setBots(nextBots);
      if (!username && nextBots[0]) update({ username: nextBots[0].username });
    }).catch((err) => {
      if (!cancelled) setError(err.message);
    });
    return () => { cancelled = true; };
  }, [view]);

  useEffect(() => {
    if (view === "statics" && !username) { setLoading(false); return undefined; }
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true); setError(""); setData(null);
    const query = new URLSearchParams({ page: String(page), limit: "50", from: activeFrom });
    if (to) query.set("to", to);
    if (debouncedQ) query.set("q", debouncedQ);
    if (side) query.set("side", side);
    if (signal) query.set("signal", signal);
    if (view === "statics") {
      query.set("username", username);
      if (env) query.set("env", env);
      if (status) query.set("status", status);
      if (profit) query.set("profit", profit);
    }
    const endpoint = view === "statics" ? "/api/account-statics" : "/api/signal-history";
    api(`${endpoint}?${query}`, { signal: controller.signal }).then((result) => {
      if (!cancelled) setData(result);
    }).catch((err) => {
      if (!cancelled) setError(err.message);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; controller.abort(); };
  }, [view, username, env, debouncedQ, side, signal, status, profit, activeFrom, to, page]);

  useEffect(() => {
    if (view !== "statics" || !trade || !username) {
      setDetail(null);
      return undefined;
    }
    let cancelled = false;
    const controller = new AbortController();
    setDetail(null);
    api(`/api/account-statics/${encodeURIComponent(trade)}?username=${encodeURIComponent(username)}`, { signal: controller.signal }).then((row) => {
      if (!cancelled) setDetail(row);
    }).catch((err) => {
      if (!cancelled) {
        setDetail(null);
        setError(err.message);
      }
    });
    return () => { cancelled = true; controller.abort(); };
  }, [view, trade, username]);

  const signalStats = view === "signals" ? data?.stats : null;
  const tradeStats = view === "statics" ? data?.stats : null;
  return (
    <section>
      <header className="page-head">
        <div>
          <h1>Lịch sử & thống kê</h1>
          <p className="muted">
            {view === "signals"
              ? "Lịch sử signal của cả hệ thống, đọc từ Signal_Infos. Mặc định 3 ngày gần nhất."
              : "Account Static là kết quả lệnh của từng config. Mặc định 3 ngày gần nhất. Bấm một dòng để xem chi tiết."}
          </p>
        </div>
      </header>
      <div className="history-tabs">
        {staticAllowed ? <button type="button" className={view === "statics" ? "active" : "ghost"} onClick={() => update({ view: "statics" })}>Account Static</button> : null}
        {signalAllowed ? <button type="button" className={view === "signals" ? "active" : "ghost"} onClick={() => update({ view: "signals" })}>Lịch sử signal</button> : null}
      </div>
      <div className="card signal-filters">
        {view === "statics" ? (
          <>
            <label>User bot<select value={username} onChange={(e) => update({ username: e.target.value, env: "" })}>{bots.map((bot) => <option key={bot.username} value={bot.username}>{bot.username}</option>)}</select></label>
            <label>Account Config<select value={env} onChange={(e) => update({ env: e.target.value })}><option value="">Tất cả config</option>{(selectedBot?.accounts || []).map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
          </>
        ) : null}
        <label>Symbol<input value={q} onChange={(e) => update({ q: e.target.value })} placeholder="BTCUSDT" /></label>
        <label>Signal<select value={signal} onChange={(e) => update({ signal: e.target.value })}><option value="">Tất cả</option>{(data?.stats?.bySignal || []).map((item) => <option key={item.signal} value={item.signal}>{item.signal}</option>)}{signal && !(data?.stats?.bySignal || []).some((item) => item.signal === signal) ? <option value={signal}>{signal}</option> : null}</select></label>
        <label>Side<select value={side} onChange={(e) => update({ side: e.target.value })}><option value="">Tất cả</option><option value="LONG">LONG</option><option value="SHORT">SHORT</option></select></label>
        {view === "statics" ? (
          <>
            <label>Status<select value={status} onChange={(e) => update({ status: e.target.value })}><option value="">Tất cả</option><option value="WIN">WIN</option><option value="LOSS">LOSS</option>{(data?.stats?.byStatus || []).filter((item) => item.status && item.status !== "WIN" && item.status !== "LOSS").map((item) => <option key={item.status} value={item.status}>{item.status}</option>)}</select></label>
            <label>Profit<select value={profit} onChange={(e) => update({ profit: e.target.value })}><option value="">Tất cả</option><option value="win">Lãi</option><option value="loss">Lỗ</option><option value="flat">Hòa</option></select></label>
          </>
        ) : null}
        <label>Từ<input type="datetime-local" value={toLocalInput(activeFrom)} onChange={(e) => update({ from: applyDatePick(activeFrom, e.target.value) || fallbackFrom })} /></label>
        <label>Đến<input type="datetime-local" value={toLocalInput(to)} onChange={(e) => update({ to: applyDatePick(to, e.target.value) })} /></label>
        <div className="history-range">
          {[1, 3, 7, 30, 90].map((days) => (
            <button type="button" className="ghost" key={days} onClick={() => update({ from: daysAgo(days), to: "" })}>{days} ngày</button>
          ))}
        </div>
      </div>
      {signalStats ? (
        <>
          <div className="stats-grid signal-stats">
            <article className="card"><span className="muted">Tổng signal</span><strong>{signalStats.total}</strong></article>
            <article className="card"><span className="muted">LONG</span><strong>{signalStats.long}</strong></article>
            <article className="card"><span className="muted">SHORT</span><strong>{signalStats.short}</strong></article>
            <article className="card"><span className="muted">Phiên nhiều signal</span><strong>{signalStats.topSession ? `${signalStats.topSession.label} · ${signalStats.topSession.count}` : "—"}</strong></article>
          </div>
          {signalStats.sessions?.length ? <div className="chips signal-chips">{signalStats.sessions.map((item) => <span className="chip" key={item.id}>{item.label} {item.hours}: {item.count}</span>)}</div> : null}
          {signalStats.byType?.length ? <div className="chips signal-chips"><span className="muted">Loại</span>{signalStats.byType.map((item) => <span className="chip" key={item.type}>{item.type}: {item.count}</span>)}</div> : null}
          {signalStats.bySymbol?.length ? (
            <div className="chips signal-chips">
              <span className="muted">Symbol</span>
              {signalStats.bySymbol.map((item) => (
                <button type="button" className={q.toUpperCase() === String(item.symbol).toUpperCase() ? "symbol-chip active" : "symbol-chip"} key={item.symbol} onClick={() => update({ q: q.toUpperCase() === String(item.symbol).toUpperCase() ? "" : item.symbol })}>
                  {item.symbol}: {item.count}
                </button>
              ))}
            </div>
          ) : null}
          {signalStats.bySignal?.length ? <div className="chips signal-chips"><span className="muted">Signal</span>{signalStats.bySignal.map((item) => <button type="button" className={signal === item.signal ? "symbol-chip active" : "symbol-chip"} key={item.signal} onClick={() => update({ signal: signal === item.signal ? "" : item.signal })}>{item.signal}: {item.count}</button>)}</div> : null}
        </>
      ) : null}
      {tradeStats ? <div className="stats-grid signal-stats"><article className="card"><span className="muted">Số lượng giao dịch</span><strong>{tradeStats.total}</strong><small className="muted">{tradeStats.wins} thắng · {tradeStats.losses} thua</small></article><article className="card"><span className="muted">Win rate</span><strong>{fmt(tradeStats.winRate, 1)}%</strong></article><article className="card"><span className="muted">Profit</span><strong>{fmt(tradeStats.profit)}$</strong></article><article className="card"><span className="muted">Volume</span><strong>{fmt(tradeStats.volume)}$</strong></article></div> : null}
      {view === "statics" && data?.stats?.byStatus?.length ? <div className="chips signal-chips"><span className="muted">Status</span>{data.stats.byStatus.map((item) => <button type="button" className={status === item.status ? "symbol-chip active" : "symbol-chip"} key={item.status} onClick={() => update({ status: status === item.status ? "" : item.status })}>{item.status}: {item.count} · {fmt(item.profit)}$</button>)}</div> : null}
      {view === "statics" && data?.stats?.bySignal?.length ? <div className="chips signal-chips"><span className="muted">Signal</span>{data.stats.bySignal.map((item) => <button type="button" className={signal === item.signal ? "symbol-chip active" : "symbol-chip"} key={item.signal} onClick={() => update({ signal: signal === item.signal ? "" : item.signal })}>{item.signal}: {item.count} lệnh · WR {fmt(item.winRate, 1)}% · {fmt(item.profit)}$</button>)}</div> : null}
      {detail ? <TradeDetail row={detail} onClose={() => update({ trade: "" })} /> : null}
      {loading ? <p className="muted">Đang tải…</p> : null}{error ? <p className="form-error">{error}</p> : null}
      {!loading && data?.rows?.length === 0 ? <div className="card empty">Không có dữ liệu trong khoảng thời gian này.</div> : null}
      {view === "signals" && data?.rows?.length ? <div className="table-wrap signal-table"><table><thead><tr><th>Thời gian</th><th>Signal</th><th>Symbol</th><th>Side</th><th>Loại</th><th>Trạng thái</th></tr></thead><tbody>{data.rows.map((row) => <tr key={row.id}><td>{fmtTime(row.openTime)}</td><td>{row.signal}</td><td>{row.symbol}</td><td>{row.side}</td><td>{row.type}</td><td>{row.status}</td></tr>)}</tbody></table></div> : null}
      {view === "statics" && data?.rows?.length ? <div className="table-wrap signal-table"><table><thead><tr><th>Thời gian</th><th>Config</th><th>Signal</th><th>Symbol</th><th>Side</th><th>Status</th><th>Profit</th><th>ROE</th></tr></thead><tbody>{data.rows.map((row) => <tr key={row.id} className={trade === row.id ? "trade-row active" : "trade-row"} tabIndex={0} onClick={() => update({ trade: trade === row.id ? "" : row.id })} onKeyDown={(event) => { if (event.key === "Enter") update({ trade: trade === row.id ? "" : row.id }); }}><td>{fmtTime(row.openTime)}</td><td>{row.env}</td><td>{row.signal}</td><td>{row.symbol}</td><td>{row.side}</td><td>{row.status}</td><td>{fmt(row.profit)}$</td><td>{fmt(row.roe)}%</td></tr>)}</tbody></table></div> : null}
      {data?.total > data?.limit ? <div className="audit-pagination"><span className="muted">Trang {data.page} · {data.total} bản ghi</span><div><button type="button" className="ghost" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>Trước</button><button type="button" className="ghost" disabled={page * data.limit >= data.total} onClick={() => update({ page: String(page + 1) })}>Sau</button></div></div> : null}
      {view === "statics" && username ? <p className="muted"><Link to={`/bots/${encodeURIComponent(username)}`}>Mở User bot {username}</Link></p> : null}
    </section>
  );
}
