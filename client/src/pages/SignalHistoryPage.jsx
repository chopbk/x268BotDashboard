import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import useDebouncedValue from "../hooks/useDebouncedValue";
import { useAuth } from "../auth";
import { ownsBot } from "../access";

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

async function loadActiveBots() {
  const rows = [];
  let page = 1;
  let total = Infinity;
  while (rows.length < total && page <= 20) {
    const data = await api(`/api/bots?active=true&page=${page}&limit=100`);
    const batch = data.bots || [];
    rows.push(...batch);
    total = Number(data.total) || rows.length;
    if (!batch.length) break;
    page += 1;
  }
  return rows;
}

function DetailItem({ label, value }) {
  return <div><dt>{label}</dt><dd>{value ?? "—"}</dd></div>;
}

function digitsFor(preferred, sample, fallback) {
  if (Number.isInteger(preferred) && preferred >= 0) return preferred;
  const amount = Math.abs(Number(sample));
  if (!Number.isFinite(amount) || amount === 0 || amount >= 1) return fallback;
  return Math.min(12, Math.max(fallback, Math.ceil(-Math.log10(amount)) + 2));
}

function fmtPrice(value, row) {
  return fmt(value, digitsFor(row.symbolInfo?.priceDecimals, value, 2));
}

function sortRows(rows, key) {
  return [...(rows || [])].sort((a, b) => (Number(b[key]) || 0) - (Number(a[key]) || 0) || (b.profit || 0) - (a.profit || 0));
}

function threshold(value, max) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0) return null;
  return max == null ? number : Math.min(number, max);
}

function keepGroup(row, rules) {
  if (rules.minWin != null && (Number(row.winRate) || 0) < rules.minWin) return false;
  if (rules.minTrades != null && (Number(row.count) || 0) < rules.minTrades) return false;
  if (rules.gain && !(Number(row.profit) > 0)) return false;
  return true;
}

function CompareTable({ title, note, rows, nameKey, nameLabel, active, onPick, sortKey, onSort }) {
  const sorted = sortRows(rows, sortKey);
  const heads = [
    ["count", "Lệnh"],
    ["winRate", "Win rate"],
    ["profit", "Profit"],
    ["avgRoi", "ROI / cost"],
    ["volume", "Volume"],
  ];
  return (
    <div className="compare-block">
      <h2 className="summary-section-title">{title}</h2>
      {note ? <p className="muted">{note}</p> : null}
      <div className="table-wrap signal-table">
        <table>
          <thead>
            <tr>
              <th>{nameLabel}</th>
              {heads.map(([key, label]) => (
                <th key={key}>
                  <button type="button" className={sortKey === key ? "th-sort active" : "th-sort"} onClick={() => onSort(key)}>{label}</button>
                </th>
              ))}
              <th>Long</th>
              <th>Short</th>
              <th>Max lãi</th>
              <th>Max lỗ</th>
              <th>ROE thắng / thua</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? <tr><td colSpan={11}>Không có dòng đạt bộ lọc.</td></tr> : null}
            {sorted.map((row) => (
              <tr key={row[nameKey]} className={active === row[nameKey] ? "trade-row active" : "trade-row"} tabIndex={0} onClick={() => onPick(row[nameKey])} onKeyDown={(event) => { if (event.key === "Enter") onPick(row[nameKey]); }}>
                <td>{row[nameKey]}</td>
                <td>{row.wins}/{row.count}</td>
                <td>{fmt(row.winRate, 1)}%</td>
                <td>{fmt(row.profit)}$</td>
                <td>{fmt(row.avgRoi, 1)}%</td>
                <td>{fmt(row.volume)}$</td>
                <td>{row.longCount} · {fmt(row.longProfit)}$</td>
                <td>{row.shortCount} · {fmt(row.shortProfit)}$</td>
                <td>{fmt(row.maxProfit)}$</td>
                <td>{fmt(row.minProfit)}$</td>
                <td>{fmt(row.avgWinRoe, 1)}% / {fmt(row.avgLossRoe, 1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TradeDetail({ row, onClose }) {
  const qtyDigits = digitsFor(row.symbolInfo?.qtyDecimals, row.positionAmt, 4);
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
        <DetailItem label="Giá vào" value={fmtPrice(row.entryPrice, row)} />
        <DetailItem label="Giá đóng" value={fmtPrice(row.closePrice, row)} />
        <DetailItem label="Đòn bẩy" value={fmt(row.leverage, 0)} />
        <DetailItem label="Cost" value={fmt(row.cost)} />
        <DetailItem label="Khối lượng" value={fmt(row.positionAmt, qtyDigits)} />
        <DetailItem label="Mở" value={fmtTime(row.openTime)} />
        <DetailItem label="Đóng" value={fmtTime(row.closeTime)} />
        <DetailItem label="TP" value={row.tps?.length ? row.tps.map((price) => fmtPrice(price, row)).join(", ") : "—"} />
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
  const [audience, setAudience] = useState("mine");
  const [data, setData] = useState(null);
  const [detail, setDetail] = useState(null);
  const [signalSort, setSignalSort] = useState("profit");
  const [envSort, setEnvSort] = useState("profit");
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
  const bookChoice = params.get("book") || "";
  const copy = params.get("copy") || "";
  const closed = params.get("closed") || "";
  const minWinText = params.get("minWin") || "";
  const minTradesText = params.get("minTrades") || "";
  const gain = params.get("gain") || "";
  const trade = params.get("trade") || "";
  const [fallbackFrom] = useState(() => daysAgo(3));
  const from = params.get("from") || "";
  const to = params.get("to") || "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const mineBots = useMemo(() => bots.filter((bot) => ownsBot(user, bot)), [bots, user]);
  const otherBots = useMemo(
    () => bots.filter((bot) => !ownsBot(user, bot) && (user?.role === "admin" || (bot.visibility || "public") !== "private")),
    [bots, user]
  );
  const listedBots = audience === "others" ? otherBots : mineBots;
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
    loadActiveBots().then((nextBots) => {
      if (cancelled) return;
      setBots(nextBots);
      const mine = nextBots.filter((bot) => ownsBot(user, bot));
      const others = nextBots.filter((bot) => !ownsBot(user, bot) && (user?.role === "admin" || (bot.visibility || "public") !== "private"));
      const current = username;
      const inMine = mine.some((bot) => bot.username === current);
      const inOthers = others.some((bot) => bot.username === current);
      if (current && inOthers && !inMine) setAudience("others");
      else if (!inMine) update({ username: mine[0]?.username || "", env: "", book: "" });
    }).catch((err) => {
      if (!cancelled) setError(err.message);
    });
    return () => { cancelled = true; };
  }, [view]);

  useEffect(() => {
    if (view !== "statics") return undefined;
    if (!username) { setLoading(false); return undefined; }
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
      if (bookChoice) query.set("book", bookChoice);
      if (copy) query.set("copy", copy);
      if (closed) query.set("closed", closed);
    }
    api(`/api/account-statics?${query}`, { signal: controller.signal }).then((result) => {
      if (!cancelled) setData(result);
    }).catch((err) => {
      if (!cancelled) setError(err.message);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; controller.abort(); };
  }, [view, username, env, debouncedQ, side, signal, status, profit, bookChoice, copy, closed, activeFrom, to, page]);

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

  const groupRules = {
    minWin: threshold(minWinText, 100),
    minTrades: threshold(minTradesText),
    gain: gain === "1",
  };
  const signalRows = useMemo(
    () => (data?.stats?.bySignal || []).filter((row) => keepGroup(row, groupRules)),
    [data, minWinText, minTradesText, gain]
  );
  const configRows = useMemo(
    () => (data?.stats?.byConfig || data?.stats?.byEnv || []).filter((row) => keepGroup(row, groupRules)),
    [data, minWinText, minTradesText, gain]
  );
  const book = bookChoice || data?.book || "live";
  const bookLabel = book === "paper" ? "paper" : book === "all" ? "live và paper" : "live";
  const ruleNote = [
    groupRules.minWin != null ? `win rate ≥ ${groupRules.minWin}%` : "",
    groupRules.minTrades != null ? `≥ ${groupRules.minTrades} lệnh` : "",
    groupRules.gain ? "profit đang lãi" : "",
    side ? `side ${side}` : "",
  ].filter(Boolean).join(", ");
  const tradeStats = view === "statics" ? data?.stats : null;
  if (view === "signals") return <Navigate to="/signal-search?tab=history" replace />;
  return (
    <section>
      <header className="page-head">
        <div>
          <h1>Account Static</h1>
          <p className="muted">Lọc signal theo win rate, số lệnh và profit. Chọn một signal rồi để Tất cả config để xem config live hoặc paper nào tốt với signal đó.</p>
        </div>
      </header>
      <div className="card signal-filters">
        {view === "statics" ? (
          <>
            <label>Phạm vi<select value={audience} onChange={(e) => { const next = e.target.value; const list = next === "others" ? otherBots : mineBots; setAudience(next); update({ username: list[0]?.username || "", env: "", book: "" }); }}><option value="mine">Của tôi</option><option value="others">Người khác</option></select></label>
            <label>User bot<select value={username} onChange={(e) => update({ username: e.target.value, env: "", book: "" })}>{listedBots.map((bot) => <option key={bot.username} value={bot.username}>{bot.username}</option>)}{username && !listedBots.some((bot) => bot.username === username) ? <option value={username}>{username}</option> : null}</select></label>
            <label>Account Config<select value={env} onChange={(e) => update({ env: e.target.value })}><option value="">Tất cả config</option>{(selectedBot?.accounts || []).map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
          </>
        ) : null}
        {view === "statics" && !listedBots.length ? <p className="muted">{audience === "mine" ? "Bạn chưa có user bot đang active." : "Không có user active của người khác."}</p> : null}
        <label>Symbol<input value={q} onChange={(e) => update({ q: e.target.value })} placeholder="BTCUSDT" /></label>
        <label>Signal<select value={signal} onChange={(e) => update({ signal: e.target.value })}><option value="">Tất cả</option>{(data?.stats?.bySignal || []).map((item) => <option key={item.signal} value={item.signal}>{item.signal}</option>)}{signal && !(data?.stats?.bySignal || []).some((item) => item.signal === signal) ? <option value={signal}>{signal}</option> : null}</select></label>
        <label>Side<select value={side} onChange={(e) => update({ side: e.target.value })}><option value="">Tất cả</option><option value="LONG">LONG</option><option value="SHORT">SHORT</option></select></label>
        {view === "statics" ? (
          <>
            <label>Status<select value={status} onChange={(e) => update({ status: e.target.value })}><option value="">Tất cả</option><option value="WIN">WIN</option><option value="LOSS">LOSS</option>{(data?.stats?.byStatus || []).filter((item) => item.status && item.status !== "WIN" && item.status !== "LOSS").map((item) => <option key={item.status} value={item.status}>{item.status}</option>)}</select></label>
            <label>Profit<select value={profit} onChange={(e) => update({ profit: e.target.value })}><option value="">Tất cả</option><option value="win">Lãi</option><option value="loss">Lỗ</option><option value="flat">Hòa</option></select></label>
            <label>Sổ<select value={book} onChange={(e) => update({ book: e.target.value })}><option value="live">Live</option><option value="paper">Paper</option><option value="all">Live và paper</option></select></label>
            <label>Copy<select value={copy} onChange={(e) => update({ copy: e.target.value })}><option value="">Tất cả</option><option value="copy">Copy</option><option value="manual">Không copy</option></select></label>
            <label>Đóng lệnh<select value={closed} onChange={(e) => update({ closed: e.target.value })}><option value="">Tất cả</option><option value="closed">Đã đóng</option><option value="open">Đang mở</option></select></label>
            <label>Win rate từ %<input type="number" min="0" max="100" step="1" value={minWinText} placeholder="60" onChange={(e) => update({ minWin: e.target.value })} /></label>
            <label>Số lệnh từ<input type="number" min="1" step="1" value={minTradesText} placeholder="10" onChange={(e) => update({ minTrades: e.target.value })} /></label>
            <label>Nhóm lãi<select value={gain} onChange={(e) => update({ gain: e.target.value })}><option value="">Tất cả</option><option value="1">Chỉ đang lãi</option></select></label>
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
      {tradeStats ? <div className="stats-grid signal-stats"><article className="card"><span className="muted">Số lượng giao dịch</span><strong>{tradeStats.total}</strong><small className="muted">{tradeStats.wins} thắng · {tradeStats.losses} thua</small></article><article className="card"><span className="muted">Win rate</span><strong>{fmt(tradeStats.winRate, 1)}%</strong></article><article className="card"><span className="muted">Profit</span><strong>{fmt(tradeStats.profit)}$</strong><small className="muted">Cost {fmt(tradeStats.cost)}$ · ROI {fmt(tradeStats.avgRoi, 1)}%</small></article><article className="card"><span className="muted">Volume</span><strong>{fmt(tradeStats.volume)}$</strong></article><article className="card"><span className="muted">Long</span><strong>{fmt(tradeStats.longProfit)}$</strong></article><article className="card"><span className="muted">Short</span><strong>{fmt(tradeStats.shortProfit)}$</strong></article></div> : null}
      {view === "statics" && data?.stats?.byStatus?.length ? <div className="chips signal-chips"><span className="muted">Status</span>{data.stats.byStatus.map((item) => <button type="button" className={status === item.status ? "symbol-chip active" : "symbol-chip"} key={item.status} onClick={() => update({ status: status === item.status ? "" : item.status })}>{item.status}: {item.count} · {fmt(item.profit)}$</button>)}</div> : null}
      {view === "statics" && data?.stats?.bySide?.length ? <div className="chips signal-chips"><span className="muted">Side</span>{data.stats.bySide.map((item) => <button type="button" className={side === item.side ? "symbol-chip active" : "symbol-chip"} key={item.side} onClick={() => update({ side: side === item.side ? "" : item.side })}>{item.side}: {item.wins}/{item.count} · WR {fmt(item.winRate, 1)}% · {fmt(item.profit)}$</button>)}</div> : null}
      {view === "statics" && data?.stats?.bySignal?.length ? <CompareTable title={env ? `Signal của ${env}` : `Signal của ${username || "user"}`} note={`${signalRows.length}/${data.stats.bySignal.length} signal${ruleNote ? ` · ${ruleNote}` : ""}. Bấm một dòng để giữ signal đó và so config.`} rows={signalRows} nameKey="signal" nameLabel="Signal" active={signal} onPick={(value) => update({ signal: signal === value ? "" : value })} sortKey={signalSort} onSort={setSignalSort} /> : null}
      {view === "statics" && env ? <p className="muted">Đang xem một config. Chọn Tất cả config để so config nào tốt hơn.</p> : null}
      {view === "statics" && !env && (data?.stats?.byConfig || data?.stats?.byEnv || []).length ? <CompareTable title={signal ? `Config ${bookLabel} của signal ${signal}` : `Config ${bookLabel} của ${username || "user"}`} note={signal ? `Mỗi dòng chỉ tính signal ${signal}${side ? `, side ${side}` : ""}. ${configRows.length} config đạt bộ lọc.` : `Chưa chọn signal nên mỗi dòng là cả config. Chọn một signal để so đúng signal đó. ${configRows.length} config đạt bộ lọc.`} rows={configRows} nameKey="env" nameLabel="Config" active={env} onPick={(value) => update({ env: value })} sortKey={envSort} onSort={setEnvSort} /> : null}
      {detail ? <TradeDetail row={detail} onClose={() => update({ trade: "" })} /> : null}
      {loading ? <p className="muted">Đang tải…</p> : null}{error ? <p className="form-error">{error}</p> : null}
      {!loading && data?.rows?.length === 0 ? <div className="card empty">Không có dữ liệu trong khoảng thời gian này.</div> : null}
      {data?.rows?.length ? <div className="table-wrap signal-table"><table><thead><tr><th>Thời gian</th><th>Config</th><th>Signal</th><th>Symbol</th><th>Side</th><th>Status</th><th>Profit</th><th>ROE</th></tr></thead><tbody>{data.rows.map((row) => <tr key={row.id} className={trade === row.id ? "trade-row active" : "trade-row"} tabIndex={0} onClick={() => update({ trade: trade === row.id ? "" : row.id })} onKeyDown={(event) => { if (event.key === "Enter") update({ trade: trade === row.id ? "" : row.id }); }}><td>{fmtTime(row.openTime)}</td><td>{row.env}</td><td>{row.signal}</td><td>{row.symbol}</td><td>{row.side}</td><td>{row.status}</td><td>{fmt(row.profit)}$</td><td>{fmt(row.roe)}%</td></tr>)}</tbody></table></div> : null}
      {data?.total > data?.limit ? <div className="audit-pagination"><span className="muted">Trang {data.page} · {data.total} bản ghi</span><div><button type="button" className="ghost" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>Trước</button><button type="button" className="ghost" disabled={page * data.limit >= data.total} onClick={() => update({ page: String(page + 1) })}>Sau</button></div></div> : null}
      {view === "statics" && username ? <p className="muted"><Link to={`/bots/${encodeURIComponent(username)}`}>Mở User bot {username}</Link></p> : null}
    </section>
  );
}
