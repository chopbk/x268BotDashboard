import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";

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

function DetailItem({ label, value }) {
  return <div><dt>{label}</dt><dd>{value ?? "—"}</dd></div>;
}

export default function SignalSearchPage() {
  const { user } = useAuth();
  const staticAllowed = can(user, "statistics.view");
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
  const [range, setRange] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [popup, setPopup] = useState(null);
  const [trades, setTrades] = useState(null);
  const [trade, setTrade] = useState(null);
  const [popupError, setPopupError] = useState("");
  const [popupBusy, setPopupBusy] = useState(false);

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
    setPopup(row);
    setTrades(null);
    setTrade(null);
    setPopupError("");
    setPopupBusy(true);
    api(`/api/account-statics?${params}`)
      .then((data) => setTrades(data))
      .catch((err) => setPopupError(err.message || "Không tải được static"))
      .finally(() => setPopupBusy(false));
  }

  function openTrade(row) {
    if (!popup || trade?.id === row.id) {
      setTrade(null);
      return;
    }
    setPopupError("");
    api(`/api/account-statics/${encodeURIComponent(row.id)}?username=${encodeURIComponent(popup.username)}`)
      .then((detail) => setTrade(detail))
      .catch((err) => setPopupError(err.message || "Không tải được lệnh"));
  }

  return (
    <section>
      <header className="page-head">
        <div>
          <h1>Tìm signal</h1>
          <p className="muted">Gõ một hoặc nhiều tên, ví dụ ROSE hoặc ROSE, BULL. Chỉ hiện config bạn được xem, tính từ lệnh thật và xếp theo bộ lọc bên dưới.</p>
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
          Xếp
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value="recent">Lệnh gần nhất</option>
            <option value="profit">Lợi nhuận</option>
            <option value="winrate">Win rate</option>
          </select>
        </label>
        <button type="submit" disabled={busy || !signal.trim()}>{busy ? "Đang tìm…" : "Tìm"}</button>
      </form>
      {error ? <p className="form-error">{error}</p> : null}
      {rows && range ? <p className="muted">Từ {fmtTime(range.from)}{range.to ? ` đến ${fmtTime(range.to)}` : ""}. Win rate là tỷ lệ lệnh có profit &gt; 0, không tính paper.</p> : null}
      {rows ? (
        rows.length === 0 ? <p className="muted">Không có config khớp.</p> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Config</th>
                  <th>Signal</th>
                  <th>Lệnh</th>
                  <th>Win rate</th>
                  <th>Profit</th>
                  <th>Gần nhất</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.username}/${row.env}`}>
                    <td>{row.username}</td>
                    <td>{row.env}</td>
                    <td>{row.matched.join(", ")}</td>
                    <td>{row.trades}</td>
                    <td>{fmt(row.winRate, 1)}%</td>
                    <td>{fmt(row.profit)}$</td>
                    <td>{fmtTime(row.lastTime)}</td>
                    <td>
                      <div className="row-actions">
                        <Link className="ghost link-btn" to={`/bots/${encodeURIComponent(row.username)}/accounts/${encodeURIComponent(row.env)}`}>
                          {row.canEdit ? "Sửa" : "Xem"}
                        </Link>
                        {staticAllowed ? (
                          <button type="button" className="ghost" onClick={() => openStatic(row)}>Static</button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
      {popup ? (
        <div className="modal-backdrop" onClick={() => setPopup(null)}>
          <div className="modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header>
              <h2>{popup.username} · {popup.env} · {popup.matched.join(", ")}</h2>
              <button type="button" className="ghost" onClick={() => setPopup(null)}>Đóng</button>
            </header>
            {popupError ? <p className="form-error">{popupError}</p> : null}
            {popupBusy ? <p className="muted">Đang tải lệnh…</p> : null}
            {trades?.stats ? <p className="muted">{trades.stats.total} lệnh · lãi {fmt(trades.stats.profit)}$ · win rate {fmt(trades.stats.winRate, 1)}%</p> : null}
            {trade ? (
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
            {trades?.rows?.length ? (
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
            ) : trades && !popupBusy ? <p className="muted">Không có lệnh trong khoảng này.</p> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
