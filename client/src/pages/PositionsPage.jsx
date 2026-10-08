import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useEscape } from "../navigation";

const WARN = {
  "no-monitor": "Chưa có monitor",
  "qty-mismatch": "Lệch qty",
  "monitor-without-position": "Monitor không thấy vị thế",
  stale: "Dữ liệu cũ",
};

function fmt(value, digits = 4) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function when(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("vi-VN");
}

function pnlClass(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "";
  return n > 0 ? "pos-up" : "pos-down";
}

function matches(row, params) {
  const symbol = (params.get("symbol") || "").trim().toUpperCase();
  const side = (params.get("side") || "").trim().toUpperCase();
  const book = (params.get("book") || "").trim().toLowerCase();
  const env = (params.get("env") || "").trim();
  if (symbol && row.symbol !== symbol) return false;
  if (side && row.side !== side) return false;
  if (book === "notpsl") {
    if (!row.notpsl && !row.monitors.some((monitor) => monitor.notpsl)) return false;
  } else if (book && row.book !== book) return false;
  if (env && !row.monitors.some((monitor) => monitor.env === env)) return false;
  if (params.get("warn") === "1" && !row.warnings.length) return false;
  return true;
}

export default function PositionsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const account = params.get("account") || "";
  const panel = params.get("panel") || "";
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(() => new Set());
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState("");
  const [monitorId, setMonitorId] = useState("");

  function go(mutate, { replace = false, layer = false } = {}) {
    const next = new URLSearchParams(location.search);
    mutate(next);
    const search = next.toString();
    navigate(
      { pathname: location.pathname, search: search ? `?${search}` : "" },
      { replace, state: layer ? { layer: (location.state?.layer || 0) + 1 } : location.state }
    );
  }

  const closePanel = useCallback(() => {
    const key = new URLSearchParams(location.search).get("panel");
    if ((location.state?.layer || 0) > 0) {
      navigate(-1);
    } else {
      const next = new URLSearchParams(location.search);
      next.delete("panel");
      const search = next.toString();
      navigate({ pathname: location.pathname, search: search ? `?${search}` : "" }, { replace: true });
    }
    window.setTimeout(() => document.querySelector(`[data-row="${CSS.escape(key || "")}"]`)?.focus(), 0);
  }, [location.pathname, location.search, location.state, navigate]);

  useEscape(Boolean(panel), closePanel);

  useEffect(() => {
    let source = null;
    let poll = null;
    let gone = false;

    function apply(view) {
      if (gone) return;
      setPayload((prev) => {
        if (view?.stale && !view.rows?.length && prev?.rows?.length) {
          return { ...prev, stale: true, connection: "stale" };
        }
        return { ...view, accounts: view.accounts?.length ? view.accounts : (prev?.accounts || []) };
      });
    }

    async function load() {
      try {
        const query = account ? `?account=${encodeURIComponent(account)}` : "";
        apply(await api(`/api/positions${query}`));
        setError("");
      } catch (err) {
        console.error("[positions]", err);
        setError(err.message || "Không tải được vị thế");
        setPayload((prev) => (prev ? { ...prev, stale: true, connection: "stale" } : prev));
      }
    }

    function startPoll() {
      if (poll) return;
      poll = window.setInterval(load, 15000);
    }

    function openStream() {
      if (!account || document.visibilityState === "hidden") {
        startPoll();
        return;
      }
      source = new EventSource(`/api/positions/stream?account=${encodeURIComponent(account)}`);
      source.addEventListener("snapshot", (event) => {
        try {
          apply(JSON.parse(event.data));
          setError("");
          if (poll) window.clearInterval(poll);
          poll = null;
        } catch (err) {
          console.error("[positions]", err);
        }
      });
      source.onerror = () => {
        setPayload((prev) => (prev ? { ...prev, stale: true, connection: "stale" } : prev));
        if (!source || source.readyState === EventSource.CLOSED) {
          source = null;
          startPoll();
        }
      };
    }

    function onVisible() {
      if (document.visibilityState === "hidden") {
        source?.close();
        source = null;
        startPoll();
        return;
      }
      if (poll) window.clearInterval(poll);
      poll = null;
      if (account && !source) openStream();
    }

    load();
    openStream();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      gone = true;
      source?.close();
      if (poll) window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [account]);

  useEffect(() => {
    if (!panel || !monitorId) {
      setDetail(null);
      return undefined;
    }
    let gone = false;
    api(`/api/positions/detail?id=${encodeURIComponent(monitorId)}`)
      .then((body) => { if (!gone) { setDetail(body); setDetailError(""); } })
      .catch((err) => {
        console.error("[positions]", err);
        if (!gone) setDetailError(err.message || "Không tải được chi tiết");
      });
    return () => { gone = true; };
  }, [panel, monitorId]);

  const rows = useMemo(() => (payload?.rows || []).filter((row) => matches(row, params)), [payload, params]);
  const selected = rows.find((row) => row.key === panel) || (payload?.rows || []).find((row) => row.key === panel);
  const envs = [...new Set((payload?.accounts || []).flatMap((item) => item.accounts || []))];
  const connection = payload?.connection || "idle";
  const stale = payload?.stale || connection === "stale";

  function setFilter(name, value) {
    const next = new URLSearchParams(location.search);
    if (value) next.set(name, value);
    else next.delete(name);
    if (name === "account") next.delete("panel");
    const search = next.toString();
    const target = { pathname: location.pathname, search: search ? `?${search}` : "" };
    if ((location.state?.layer || 0) > 0 && next.get("panel")) {
      const under = new URLSearchParams(next);
      under.delete("panel");
      const underSearch = under.toString();
      navigate({ pathname: location.pathname, search: underSearch ? `?${underSearch}` : "" }, { replace: true });
      navigate(target, { state: { layer: 1 } });
      return;
    }
    navigate(target, { replace: true });
  }

  function toggle(key) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <section className="stack">
      <header>
        <h1>Position</h1>
        <p className="muted">Xem vị thế live và monitor. Không đặt hay đóng lệnh từ đây.</p>
      </header>
      <form className="signal-filters" onSubmit={(event) => event.preventDefault()}>
        <label>Tài khoản
          <select value={account} onChange={(event) => setFilter("account", event.target.value)}>
            <option value="">Tất cả</option>
            {(payload?.accounts || []).map((item) => <option key={item.username} value={item.username}>{item.username}</option>)}
          </select>
        </label>
        <label>Config
          <select value={params.get("env") || ""} onChange={(event) => setFilter("env", event.target.value)}>
            <option value="">Tất cả</option>
            {envs.map((env) => <option key={env} value={env}>{env}</option>)}
          </select>
        </label>
        <label>Symbol
          <input value={params.get("symbol") || ""} onChange={(event) => setFilter("symbol", event.target.value.toUpperCase())} />
        </label>
        <label>Side
          <select value={params.get("side") || ""} onChange={(event) => setFilter("side", event.target.value)}>
            <option value="">Tất cả</option>
            <option value="LONG">LONG</option>
            <option value="SHORT">SHORT</option>
          </select>
        </label>
        <label>Sổ
          <select value={params.get("book") || ""} onChange={(event) => setFilter("book", event.target.value)}>
            <option value="">Tất cả</option>
            <option value="live">Live</option>
            <option value="paper">Paper</option>
            <option value="pending">Lệnh chờ</option>
            <option value="notpsl">NOTPSL</option>
          </select>
        </label>
        <label>Bất thường
          <select value={params.get("warn") || ""} onChange={(event) => setFilter("warn", event.target.value)}>
            <option value="">Tất cả</option>
            <option value="1">Chỉ cảnh báo</option>
          </select>
        </label>
      </form>
      <p className={stale ? "pos-status pos-stale" : "pos-status"}>
        {account ? (connection === "live" ? "Kết nối live" : connection === "polling" ? "Đang polling" : stale ? "Mất kết nối, giữ dữ liệu cuối" : "Snapshot") : "Chọn tài khoản để nhận live"}
        {payload?.updatedAt ? ` · cập nhật ${when(payload.updatedAt)}` : ""}
      </p>
      {error ? <p className="form-error">{error}</p> : null}
      {!payload ? <p className="muted">Đang tải…</p> : null}
      {payload && !rows.length && !stale ? <p className="muted">Không có vị thế trong bộ lọc này.</p> : null}
      {payload && !rows.length && stale ? <p className="pos-stale">Chưa có snapshot mới. Không coi đây là hết vị thế.</p> : null}
      {rows.length ? (
        <div className="table-wrap">
          <table className="pos-table">
            <thead>
              <tr>
                <th />
                <th>Tài khoản</th>
                <th>Symbol</th>
                <th>Side</th>
                <th>Qty sàn</th>
                <th>Entry</th>
                <th>Mark</th>
                <th>PnL</th>
                <th>Leverage</th>
                <th>Liq</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Fragment key={row.key}>
                  <tr className={row.warnings.length ? "pos-alert" : ""}>
                    <td><button type="button" className="ghost" onClick={() => toggle(row.key)}>{open.has(row.key) ? "−" : "+"}</button></td>
                    <td>{row.account}</td>
                    <td><button type="button" className="linkish" data-row={row.key} onClick={(event) => { setMonitorId(""); go((query) => query.set("panel", row.key), { layer: true }); event.currentTarget.blur(); }}>{row.symbol}</button></td>
                    <td>{row.side} · {row.book}{row.notpsl ? " · NOTPSL" : ""}</td>
                    <td>{row.exchangeQty == null ? "—" : fmt(row.exchangeQty)}</td>
                    <td>{fmt(row.entry)}</td>
                    <td>{fmt(row.mark)}</td>
                    <td className={pnlClass(row.unrealized)}>{row.unrealized == null ? "—" : fmt(row.unrealized)}</td>
                    <td>{row.leverage == null ? "—" : fmt(row.leverage, 2)}</td>
                    <td>{fmt(row.liquidation)}</td>
                  </tr>
                  {open.has(row.key) ? row.monitors.map((monitor) => (
                    <tr key={monitor.id} className="pos-child">
                      <td />
                      <td colSpan={9}>
                        <button type="button" className="linkish" onClick={() => { setMonitorId(monitor.id); go((query) => query.set("panel", row.key), { layer: true }); }}>
                          {monitor.env || "config"}
                        </button>
                        {" · "}{monitor.signal || monitor.type || "—"}
                        {" · qty riêng "}{fmt(monitor.ownQty)}
                        {" · sàn snapshot "}{fmt(monitor.exchangeSnapshotQty)}
                        {" · SL "}{monitor.sl || "—"} dự kiến
                        {" · TP "}{monitor.tp || "—"} dự kiến
                        {" · trailing "}{monitor.trailing || "—"}
                        {" · HP "}{monitor.hp || "—"}
                        {" · mở "}{when(monitor.openedAt)}
                        {" · cập nhật "}{when(monitor.updatedAt)}
                        {" · "}{monitor.watching ? "Đang theo dõi" : "Không có heartbeat"}
                        {monitor.estimatedPnl != null ? <span className={pnlClass(monitor.estimatedPnl)}> · PnL {fmt(monitor.estimatedPnl)} ước tính</span> : null}
                      </td>
                    </tr>
                  )) : null}
                  {open.has(row.key) && !row.monitors.length ? <tr className="pos-child"><td /><td colSpan={9}>Không có monitor cho vị thế này.</td></tr> : null}
                  {row.warnings.length ? <tr className="pos-child"><td /><td colSpan={9}>{row.warnings.map((item) => WARN[item] || item).join(" · ")}</td></tr> : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {panel && selected ? (
        <div className="modal-backdrop" onClick={closePanel}>
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="pos-title" onClick={(event) => event.stopPropagation()}>
            <header>
              <h2 id="pos-title">{selected.account} · {selected.symbol} · {selected.side}</h2>
              <button type="button" onClick={closePanel}>Đóng</button>
            </header>
            <p className="muted">PnL sàn {selected.unrealized == null ? "—" : fmt(selected.unrealized)}. Order dưới đây tách phần dự kiến của monitor và phần sàn đã xác nhận.</p>
            <h3>Order sàn đã xác nhận</h3>
            <OrderList rows={[...(selected.exchangeOrders || []), ...(selected.algoOrders || [])]} empty="Không có order thường hay algo đang mở." />
            <h3>Monitor</h3>
            {selected.monitors.map((monitor) => (
              <button key={monitor.id} type="button" className={monitorId === monitor.id ? "" : "ghost"} onClick={() => setMonitorId(monitor.id)}>
                {monitor.env} · {monitor.signal || monitor.type || "monitor"} · qty {fmt(monitor.ownQty)}
              </button>
            ))}
            {!selected.monitors.length ? <p className="muted">Vị thế chưa có monitor.</p> : null}
            {detailError ? <p className="form-error">{detailError}</p> : null}
            {detail?.monitor ? <MonitorDetail body={detail} /> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function OrderList({ rows, empty }) {
  if (!rows.length) return <p className="muted">{empty}</p>;
  return (
    <ul className="pos-list">
      {rows.map((order) => (
        <li key={`${order.kind}-${order.id}`}>{order.kind} #{order.id} · {order.type} · {order.side} {order.positionSide} · qty {fmt(order.qty)} · giá {fmt(order.price)} · {order.status} · {order.confirmed ? "đã xác nhận" : "dự kiến"}</li>
      ))}
    </ul>
  );
}

function MonitorDetail({ body }) {
  const monitor = body.monitor;
  return (
    <div className="pos-detail">
      <h3>Order dự kiến của monitor</h3>
      <OrderList rows={monitor.expectedOrders || []} empty="Monitor chưa ghi SL/TP dự kiến." />
      <h3>Fills</h3>
      <pre>{JSON.stringify(monitor.fills || [], null, 2)}</pre>
      <h3>Logs</h3>
      <pre>{JSON.stringify([...(monitor.openLogs || []), ...(monitor.logs || [])], null, 2)}</pre>
      <h3>Stats</h3>
      <pre>{JSON.stringify(monitor.stats || {}, null, 2)}</pre>
      <h3>Snapshot config</h3>
      <pre>{JSON.stringify(monitor.config || {}, null, 2)}</pre>
    </div>
  );
}
