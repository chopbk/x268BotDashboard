import { useMemo, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { canEditResource } from "../access";

const CONFIG_EDIT = "config.edit";
const can = (user, permission) => (user?.permissions || []).includes(permission);
const DAY_MS = 24 * 60 * 60 * 1000;
const fmtTime = (value) => value ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value)) : "—";
const fmt = (value, digits = 2) => value == null || value === "" || !Number.isFinite(Number(value)) ? "—" : Number(value).toFixed(digits);

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

function configLine(row) {
  const config = row.config;
  if (!config) return "—";
  const side = [config.long ? "Long" : null, config.short ? "Short" : null].filter(Boolean).join("/") || "không side";
  const volume = config.volume == null ? "" : ` · vol ${fmt(config.volume, 0)}$`;
  const sync = config.syncFrom ? ` · sync ${config.syncFrom}` : "";
  return `${config.on ? "On" : "Tắt"} · ${side} · ${config.mode}${volume} · ${config.openType}${sync}`;
}

function sortValue(row, key) {
  if (key === "username") return row.username || "";
  if (key === "env") return row.env || "";
  if (key === "signal") return (row.matched || []).join(", ");
  if (key === "trades") return row.trades || 0;
  if (key === "winRate") return row.winRate || 0;
  if (key === "profit") return row.profit || 0;
  if (key === "lastTime") return row.lastTime ? new Date(row.lastTime).getTime() : 0;
  if (key === "config") return configLine(row);
  return "";
}

function DetailItem({ label, value }) {
  return <div><dt>{label}</dt><dd>{value ?? "—"}</dd></div>;
}

function SortHead({ label, name, order, onSort }) {
  const active = order?.key === name;
  return (
    <th aria-sort={active ? (order.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="sort-col" onClick={() => onSort(name)}>
        {label}{active ? (order.dir === "asc" ? " ↑" : " ↓") : ""}
      </button>
    </th>
  );
}

export default function SignalSearchPage() {
  const { user } = useAuth();
  const staticAllowed = can(user, "statistics.view");
  const editAllowed = can(user, CONFIG_EDIT);
  const [signal, setSignal] = useState("");
  const [days, setDays] = useState("30");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [minWinRate, setMinWinRate] = useState("");
  const [profit, setProfit] = useState("");
  const [profitOp, setProfitOp] = useState("gt");
  const [minTrades, setMinTrades] = useState("");
  const [sort, setSort] = useState("recent");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState(null);
  const [order, setOrder] = useState(null);
  const [range, setRange] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState(null);
  const [trades, setTrades] = useState(null);
  const [trade, setTrade] = useState(null);
  const [detail, setDetail] = useState(null);
  const [targets, setTargets] = useState([]);
  const [targetUser, setTargetUser] = useState("");
  const [targetConfigs, setTargetConfigs] = useState([]);
  const [targetEnv, setTargetEnv] = useState("");
  const [copyName, setCopyName] = useState("");
  const [notice, setNotice] = useState("");
  const [popupError, setPopupError] = useState("");
  const [popupBusy, setPopupBusy] = useState(false);

  const shown = useMemo(() => {
    if (!rows) return null;
    if (!order) return rows;
    const dir = order.dir === "asc" ? 1 : -1;
    return [...rows].sort((left, right) => {
      const a = sortValue(left, order.key);
      const b = sortValue(right, order.key);
      if (typeof a === "number" && typeof b === "number") return (a - b) * dir;
      return String(a).localeCompare(String(b), "vi") * dir;
    });
  }, [rows, order]);

  function searchParams() {
    const params = new URLSearchParams();
    params.set("signal", signal.trim());
    if (from || to) {
      if (from) params.set("from", from);
      if (to) params.set("to", to);
    } else {
      params.set("days", days);
    }
    if (minWinRate.trim()) params.set("minWinRate", minWinRate.trim());
    if (profit.trim()) {
      params.set("profit", profit.trim());
      params.set("profitOp", profitOp);
    }
    if (minTrades.trim()) params.set("minTrades", minTrades.trim());
    if (q.trim()) params.set("q", q.trim());
    params.set("sort", sort);
    return params;
  }

  function onSearch(event) {
    event.preventDefault();
    if (!signal.trim()) return;
    setBusy(true);
    setError("");
    setOrder(null);
    api(`/api/bots/config-search?${searchParams()}`)
      .then((data) => {
        setRows(data.rows || []);
        setRange({ from: data.from, to: data.to });
      })
      .catch((err) => {
        setRows(null);
        setError(err.message || "Không tìm được signal");
      })
      .finally(() => setBusy(false));
  }

  function toggleSort(key) {
    setOrder((current) => {
      if (current?.key === key) return { key, dir: current.dir === "desc" ? "asc" : "desc" };
      const text = key === "username" || key === "env" || key === "signal" || key === "config";
      return { key, dir: text ? "asc" : "desc" };
    });
  }

  function closePanel() {
    setPanel(null);
    setTrades(null);
    setTrade(null);
    setDetail(null);
    setNotice("");
    setPopupError("");
  }

  function openStatic(row) {
    if (!staticAllowed) return;
    const params = new URLSearchParams();
    params.set("username", row.username);
    params.set("env", row.env);
    params.set("signal", row.matched.join(","));
    params.set("limit", "50");
    const start = from || range?.from;
    const end = to || range?.to;
    if (start) params.set("from", start);
    if (end) params.set("to", end);
    setPanel({ kind: "static", row });
    setTrades(null);
    setTrade(null);
    setPopupError("");
    setNotice("");
    setPopupBusy(true);
    api(`/api/account-statics?${params}`)
      .then((data) => setTrades(data))
      .catch((err) => setPopupError(err.message || "Không tải được static"))
      .finally(() => setPopupBusy(false));
  }

  function openConfig(row) {
    setPanel({ kind: "config", row });
    setDetail(null);
    setPopupError("");
    setNotice("");
    setPopupBusy(true);
    api(`/api/bots/${encodeURIComponent(row.username)}/configs/${encodeURIComponent(row.env)}`)
      .then((data) => setDetail(data.config))
      .catch((err) => setPopupError(err.message || "Không tải được config"))
      .finally(() => setPopupBusy(false));
  }

  async function loadTargets() {
    const data = await api("/api/bots?limit=100");
    return (data.bots || []).filter((bot) => canEditResource(user, CONFIG_EDIT, bot));
  }

  async function openCopy(row) {
    setPanel({ kind: "copy", row });
    setCopyName("");
    setTargetUser("");
    setNotice("");
    setPopupError("");
    setPopupBusy(true);
    try {
      const bots = await loadTargets();
      setTargets(bots);
      setTargetUser(bots[0]?.username || "");
    } catch (err) {
      setPopupError(err.message || "Không tải được user");
    } finally {
      setPopupBusy(false);
    }
  }

  async function openSync(row) {
    setPanel({ kind: "sync", row });
    setTargetEnv("");
    setTargetConfigs([]);
    setNotice("");
    setPopupError("");
    setPopupBusy(true);
    try {
      const bots = await loadTargets();
      setTargets(bots);
      const first = bots[0]?.username || "";
      setTargetUser(first);
      if (first) await loadTargetConfigs(first, row);
    } catch (err) {
      setPopupError(err.message || "Không tải được user");
    } finally {
      setPopupBusy(false);
    }
  }

  async function loadTargetConfigs(username, row = panel?.row) {
    const data = await api(`/api/bots/${encodeURIComponent(username)}/configs`);
    const configs = (data.configs || []).filter((item) => !(username === row?.username && item.env === row?.env));
    setTargetConfigs(configs);
    setTargetEnv(configs[0]?.env || "");
  }

  function openTrade(row) {
    if (!panel || trade?.id === row.id) {
      setTrade(null);
      return;
    }
    setPopupError("");
    api(`/api/account-statics/${encodeURIComponent(row.id)}?username=${encodeURIComponent(panel.row.username)}`)
      .then((next) => setTrade(next))
      .catch((err) => setPopupError(err.message || "Không tải được lệnh"));
  }

  async function onCopy(event) {
    event.preventDefault();
    if (!panel?.row || !targetUser || !copyName.trim()) return;
    setPopupBusy(true);
    setPopupError("");
    setNotice("");
    try {
      const data = await api(`/api/bots/${encodeURIComponent(panel.row.username)}/configs/${encodeURIComponent(panel.row.env)}/copy`, {
        method: "POST",
        body: { username: targetUser, env: copyName.trim() },
      });
      setNotice(`Đã copy sang ${data.username}/${data.env}. Bot nhận bản mới sau khi restart.`);
    } catch (err) {
      setPopupError(err.message || "Không copy được");
    } finally {
      setPopupBusy(false);
    }
  }

  async function onSync(event) {
    event.preventDefault();
    if (!panel?.row || !targetUser || !targetEnv) return;
    setPopupBusy(true);
    setPopupError("");
    setNotice("");
    try {
      await api(`/api/bots/${encodeURIComponent(targetUser)}/configs/${encodeURIComponent(targetEnv)}`, {
        method: "PATCH",
        body: { syncFrom: panel.row.env },
      });
      setNotice(`Đã gắn ${targetUser}/${targetEnv} sync từ ${panel.row.env}. Bot nhận bản mới sau khi restart.`);
    } catch (err) {
      setPopupError(err.message || "Không sync được");
    } finally {
      setPopupBusy(false);
    }
  }

  return (
    <section>
      <header className="page-head">
        <div>
          <h1>Tìm signal</h1>
          <p className="muted">Gõ một hoặc nhiều tên, ví dụ ROSE hoặc ROSE, BULL. Chỉ hiện config có lệnh thật để chọn bản tốt, rồi xem, copy hoặc sync ngay tại đây.</p>
        </div>
      </header>
      <form className="card signal-filters" onSubmit={onSearch}>
        <label>
          Signal
          <input value={signal} placeholder="ROSE, BULL" onChange={(event) => setSignal(event.target.value)} />
        </label>
        <label>
          Thời gian
          <select value={from || to ? "custom" : days} onChange={(event) => { if (event.target.value === "custom") return; setDays(event.target.value); setFrom(""); setTo(""); }}>
            {from || to ? <option value="custom">Tuỳ chọn</option> : null}
            <option value="1">1 ngày</option>
            <option value="3">3 ngày</option>
            <option value="7">7 ngày</option>
            <option value="30">30 ngày</option>
            <option value="90">90 ngày</option>
          </select>
        </label>
        <label>
          Từ
          <input type="datetime-local" value={toLocalInput(from)} onChange={(event) => setFrom(applyDatePick(from, event.target.value))} />
        </label>
        <label>
          Đến
          <input type="datetime-local" value={toLocalInput(to)} onChange={(event) => setTo(applyDatePick(to, event.target.value))} />
        </label>
        <label>
          Win rate tối thiểu (%)
          <input inputMode="decimal" value={minWinRate} placeholder="50" onChange={(event) => setMinWinRate(event.target.value)} />
        </label>
        <label>
          Lợi nhuận
          <span className="volume-filter-row">
            <select value={profitOp} onChange={(event) => setProfitOp(event.target.value)}>
              <option value="gt">Lớn hơn</option>
              <option value="lt">Bé hơn</option>
            </select>
            <input inputMode="decimal" value={profit} placeholder="0" onChange={(event) => setProfit(event.target.value)} />
          </span>
        </label>
        <label>
          Số lệnh tối thiểu
          <input inputMode="numeric" value={minTrades} placeholder="5" onChange={(event) => setMinTrades(event.target.value)} />
        </label>
        <label>
          User hoặc config
          <input value={q} placeholder="user / tên config" onChange={(event) => setQ(event.target.value)} />
        </label>
        <label>
          Lấy trước
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="recent">Lệnh gần nhất</option>
            <option value="profit">Lợi nhuận</option>
            <option value="winrate">Win rate</option>
          </select>
        </label>
        <button type="submit" disabled={busy || !signal.trim()}>{busy ? "Đang tìm…" : "Tìm"}</button>
      </form>
      {error ? <p className="form-error">{error}</p> : null}
      {shown && range ? <p className="muted">Từ {fmtTime(range.from)}{range.to ? ` đến ${fmtTime(range.to)}` : ""}. Bỏ config chưa có lệnh. Bấm tiêu đề cột để xếp lại. Win rate là tỷ lệ lệnh có profit &gt; 0, không tính paper.</p> : null}
      {shown ? (
        shown.length === 0 ? <p className="muted">Không có config có lệnh trong khoảng này.</p> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <SortHead label="User" name="username" order={order} onSort={toggleSort} />
                  <SortHead label="Config" name="env" order={order} onSort={toggleSort} />
                  <SortHead label="Signal" name="signal" order={order} onSort={toggleSort} />
                  <SortHead label="Lệnh" name="trades" order={order} onSort={toggleSort} />
                  <SortHead label="Win rate" name="winRate" order={order} onSort={toggleSort} />
                  <SortHead label="Profit" name="profit" order={order} onSort={toggleSort} />
                  <SortHead label="Gần nhất" name="lastTime" order={order} onSort={toggleSort} />
                  <SortHead label="Cấu hình" name="config" order={order} onSort={toggleSort} />
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={`${row.username}/${row.env}`}>
                    <td>{row.username}</td>
                    <td>{row.env}</td>
                    <td>{row.matched.join(", ")}</td>
                    <td>{row.trades}</td>
                    <td>{fmt(row.winRate, 1)}%</td>
                    <td>{fmt(row.profit)}$</td>
                    <td>{fmtTime(row.lastTime)}</td>
                    <td><span className="config-brief muted">{configLine(row)}</span></td>
                    <td>
                      <div className="row-actions">
                        <button type="button" className="ghost" onClick={() => openConfig(row)}>Xem</button>
                        {staticAllowed ? <button type="button" className="ghost" onClick={() => openStatic(row)}>Static</button> : null}
                        {editAllowed && row.canEdit ? <button type="button" className="ghost" onClick={() => openCopy(row)}>Copy</button> : null}
                        {editAllowed ? <button type="button" className="ghost" onClick={() => openSync(row)}>Sync</button> : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
      {panel ? (
        <div className="modal-backdrop" onClick={closePanel}>
          <div className="modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header>
              <h2>{panel.row.username} · {panel.row.env} · {panel.row.matched.join(", ")}</h2>
              <button type="button" className="ghost" onClick={closePanel}>Đóng</button>
            </header>
            {popupError ? <p className="form-error">{popupError}</p> : null}
            {notice ? <p className="muted">{notice}</p> : null}
            {popupBusy ? <p className="muted">Đang tải…</p> : null}
            {panel.kind === "config" && detail ? (
              <dl>
                <DetailItem label="On" value={detail.on ? "Bật" : "Tắt"} />
                <DetailItem label="Long" value={detail.long ? "Bật" : "Tắt"} />
                <DetailItem label="Short" value={detail.short ? "Bật" : "Tắt"} />
                <DetailItem label="Mode" value={detail.mode} />
                <DetailItem label="Volume" value={detail.volume == null ? "—" : `${fmt(detail.volume)} $`} />
                <DetailItem label="Mở" value={detail.openType} />
                <DetailItem label="TP" value={`${detail.tpType || "—"} ${(detail.tpPercent || []).join(", ")}`.trim()} />
                <DetailItem label="SL" value={`${detail.slType || "—"} ${detail.sl ?? ""}`.trim()} />
                <DetailItem label="Signal" value={(detail.signals || []).join(", ") || "—"} />
                <DetailItem label="Sync from" value={detail.syncFrom || "—"} />
              </dl>
            ) : null}
            {panel.kind === "copy" && !popupBusy ? (
              <form className="action-form" onSubmit={onCopy}>
                <p className="muted">Tạo config mới từ bản này. Cần quyền sửa cả user nguồn và user đích.</p>
                <label>
                  User đích
                  <select value={targetUser} onChange={(event) => setTargetUser(event.target.value)}>
                    {targets.length === 0 ? <option value="">Không có user bạn được sửa</option> : null}
                    {targets.map((bot) => <option key={bot.username} value={bot.username}>{bot.username}</option>)}
                  </select>
                </label>
                <label>
                  Tên config mới
                  <input value={copyName} onChange={(event) => setCopyName(event.target.value)} required />
                </label>
                <button type="submit" disabled={popupBusy || !targetUser || !copyName.trim()}>Copy</button>
              </form>
            ) : null}
            {panel.kind === "sync" && !popupBusy ? (
              <form className="action-form" onSubmit={onSync}>
                <p className="muted">Gắn một config của bạn theo bản này. Nhánh bị ghi đè khi gốc đổi, trừ nhóm trong Sync except.</p>
                <label>
                  User của bạn
                  <select value={targetUser} onChange={(event) => { setTargetUser(event.target.value); if (event.target.value) loadTargetConfigs(event.target.value).catch((err) => setPopupError(err.message || "Không tải được config")); }}>
                    {targets.length === 0 ? <option value="">Không có user bạn được sửa</option> : null}
                    {targets.map((bot) => <option key={bot.username} value={bot.username}>{bot.username}</option>)}
                  </select>
                </label>
                <label>
                  Config nhận sync
                  <select value={targetEnv} onChange={(event) => setTargetEnv(event.target.value)}>
                    {targetConfigs.length === 0 ? <option value="">Không có config</option> : null}
                    {targetConfigs.map((item) => <option key={item.env} value={item.env}>{item.env}</option>)}
                  </select>
                </label>
                <button type="submit" disabled={popupBusy || !targetUser || !targetEnv}>Sync</button>
              </form>
            ) : null}
            {panel.kind === "static" && trades?.stats ? <p className="muted">{trades.stats.total} lệnh · lãi {fmt(trades.stats.profit)}$ · win rate {fmt(trades.stats.winRate, 1)}%</p> : null}
            {panel.kind === "static" && trade ? (
              <article className="card trade-detail">
                <header>
                  <h2>{trade.symbol || "Giao dịch"} · {trade.side || "—"}</h2>
                  <button type="button" className="ghost" onClick={() => setTrade(null)}>Đóng lệnh</button>
                </header>
                <dl>
                  <DetailItem label="Config" value={trade.env} />
                  <DetailItem label="Signal" value={trade.signal} />
                  <DetailItem label="Status" value={trade.status} />
                  <DetailItem label="Profit" value={`${fmt(trade.profit)} $`} />
                  <DetailItem label="ROE" value={`${fmt(trade.roe)} %`} />
                  <DetailItem label="Volume" value={`${fmt(trade.volume)} $`} />
                  <DetailItem label="Mở" value={fmtTime(trade.openTime)} />
                  <DetailItem label="Đóng" value={fmtTime(trade.closeTime)} />
                  <DetailItem label="Paper" value={trade.paper ? "Có" : "Không"} />
                </dl>
              </article>
            ) : null}
            {panel.kind === "static" && trades?.rows?.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Thời gian</th>
                      <th>Signal</th>
                      <th>Symbol</th>
                      <th>Side</th>
                      <th>Status</th>
                      <th>Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.rows.map((row) => (
                      <tr key={row.id} className="trade-row" tabIndex={0} onClick={() => openTrade(row)} onKeyDown={(event) => { if (event.key === "Enter") openTrade(row); }}>
                        <td>{fmtTime(row.openTime)}</td>
                        <td>{row.signal}</td>
                        <td>{row.symbol}</td>
                        <td>{row.side}</td>
                        <td>{row.status}</td>
                        <td>{fmt(row.profit)}$</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : panel.kind === "static" && trades && !popupBusy ? <p className="muted">Không có lệnh trong khoảng này.</p> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
