import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { useEscape } from "../navigation";
import { POSITION_COLUMNS, qtyOf, roiOf, sortedRows, volumeOf } from "../position-sort";
import PositionHistory from "./PositionHistory";

const WARN = {
  "no-monitor": "Chưa có monitor",
  "qty-mismatch": "Lệch qty",
  "closed-on-exchange": "Đã đóng trên sàn, monitor chưa cập nhật",
  "monitor-without-position": "Monitor không thấy vị thế",
  stale: "Dữ liệu cũ",
};

function fmt(value, digits = 4) {
  if (value == null || value === "") return "—";
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
  const signal = (params.get("signal") || "").trim().toUpperCase();
  const side = (params.get("side") || "").trim().toUpperCase();
  const book = (params.get("book") || "").trim().toLowerCase();
  const env = (params.get("env") || "").trim();
  if (symbol && !String(row.symbol || "").toUpperCase().includes(symbol)) return false;
  if (signal && !(row.monitors || []).some((monitor) => `${monitor.signal || ""} ${monitor.type || ""}`.toUpperCase().includes(signal))) return false;
  if (side && row.side !== side) return false;
  if (book === "all") {
    if (row.book === "pending") return false;
  } else if (book === "notpsl") {
    if (!row.notpsl && !row.monitors.some((monitor) => monitor.notpsl)) return false;
  } else if (book === "paper" || book === "pending") {
    if (row.book !== book) return false;
  } else if (row.book === "paper" || row.book === "pending") return false;
  if (env && !row.monitors.some((monitor) => monitor.env === env)) return false;
  if (params.get("warn") === "1" && !row.warnings.length) return false;
  return true;
}

const ACTION_NOTE = "Market, Limit, Reverse và thêm TP/SL chưa gửi lệnh lên sàn. Xoá monitor chỉ xoá bản ghi.";

function tpslText(row) {
  const monitors = row.monitors || [];
  const sl = monitors.map((monitor) => monitor.sl).find(Boolean);
  const tp = monitors.map((monitor) => monitor.tp).find(Boolean);
  if (!sl && !tp) return monitors.length ? "Chưa có TP/SL" : "—";
  return `TP ${tp || "—"} / SL ${sl || "—"}`;
}

export default function PositionsPage() {
  const { user } = useAuth();
  const canClose = (user?.permissions || []).includes("positions.close");
  const canOpen = (user?.permissions || []).includes("positions.open");
  const canPositions = (user?.permissions || []).includes("positions.view");
  const canHistory = (user?.permissions || []).includes("statistics.view");
  const location = useLocation();
  const navigate = useNavigate();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const account = params.get("account") || "";
  const audience = params.get("audience") === "all" ? "all" : "mine";
  const book = params.get("book") || "";
  const panel = params.get("panel") || "";
  const tab = params.get("tab") === "history" ? "history" : "open";
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(() => new Set());
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState("");
  const [monitorId, setMonitorId] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [sort, setSort] = useState({ key: "", dir: "desc" });
  const [actionNote, setActionNote] = useState("");
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [historyAccounts, setHistoryAccounts] = useState([]);

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
    if (!canPositions || tab === "history") return undefined;
    let socket = null;
    let poll = null;
    let retry = null;
    let gone = false;
    let attempt = 0;
    let lastPush = 0;
    let pushRevision = 0;

    function apply(view) {
      if (gone || document.visibilityState === "hidden" || !view) return;
      setPayload((prev) => {
        const versions = new Map((prev?.sources || []).map((item) => [item.account, item.version]));
        if ((view.sources || []).some((item) => item.version != null && versions.get(item.account) != null && item.version < versions.get(item.account))) return prev;
        return view;
      });
    }

    async function load() {
      try {
        const query = new URLSearchParams();
        query.set("audience", audience);
        if (book) query.set("book", book);
        if (account) query.set("account", account);
        const before = pushRevision;
        const view = await api(`/api/positions?${query}`);
        if (before === pushRevision) apply(view);
        setError("");
      } catch (err) {
        console.error("[positions]", err);
        setError(err.message || "Không tải được vị thế");
        setPayload((prev) => (prev ? { ...prev, stale: true, connection: "stale" } : prev));
      }
    }

    function startPoll() {
      if (poll) return;
      poll = window.setInterval(() => {
        if (document.visibilityState === "hidden") return;
        if (socket?.readyState === WebSocket.OPEN && Date.now() - lastPush < 30_000) return;
        load();
      }, 15000);
    }

    function send(type) {
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ type, account, audience, book }));
    }

    function openSocket() {
      if (document.visibilityState === "hidden") return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const current = new WebSocket(`${proto}//${window.location.host}/api/positions/ws`);
      socket = current;
      current.onopen = () => {
        if (socket !== current) return;
        attempt = 0;
        send("watch");
      };
      current.onmessage = (event) => {
        if (socket !== current) return;
        try {
          const message = JSON.parse(event.data);
          if (message.type === "error") {
            setError(message.error || "Không xem được vị thế");
            return;
          }
          if (message.type === "snapshot") {
            lastPush = Date.now();
            pushRevision += 1;
            apply(message);
            setError("");
          }
        } catch (err) {
          console.error("[positions]", err);
        }
      };
      current.onclose = () => {
        if (socket !== current) return;
        socket = null;
        setPayload((prev) => {
          if (!prev || prev.connection === "monitor" || prev.connection === "idle") return prev;
          return { ...prev, stale: true, connection: "stale" };
        });
        if (gone || document.visibilityState === "hidden") return;
        const wait = Math.min(10000, 1000 * (2 ** attempt));
        attempt += 1;
        retry = window.setTimeout(openSocket, wait);
      };
    }

    function onVisible() {
      if (document.visibilityState === "hidden") {
        send("pause");
        if (poll) window.clearInterval(poll);
        poll = null;
        return;
      }
      startPoll();
      if (socket?.readyState === WebSocket.OPEN) send("resume");
      else openSocket();
    }

    load();
    openSocket();
    startPoll();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      gone = true;
      send("pause");
      socket?.close();
      if (poll) window.clearInterval(poll);
      if (retry) window.clearTimeout(retry);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [account, audience, book, canPositions, tab]);

  useEffect(() => {
    if (!panel || !monitorId) {
      setDetail(null);
      return undefined;
    }
    let gone = false;
    api(`/api/positions/detail?id=${encodeURIComponent(monitorId)}&audience=${encodeURIComponent(audience)}`)
      .then((body) => { if (!gone) { setDetail(body); setDetailError(""); } })
      .catch((err) => {
        console.error("[positions]", err);
        if (!gone) setDetailError(err.message || "Không tải được chi tiết");
      });
    return () => { gone = true; };
  }, [panel, monitorId]);

  const rows = useMemo(
    () => sortedRows((payload?.rows || []).filter((row) => matches(row, params)), sort.key, sort.dir),
    [payload, params, sort]
  );

  function toggleSort(key) {
    setSort((prev) => {
      if (prev.key !== key) return { key, dir: POSITION_COLUMNS.find((column) => column.id === key)?.text ? "asc" : "desc" };
      return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
    });
  }
  const selected = rows.find((row) => row.key === panel) || (payload?.rows || []).find((row) => row.key === panel);
  const accountRows = tab === "history" ? historyAccounts : (payload?.accounts || []);
  const envs = [...new Set(accountRows.flatMap((item) => item.accounts || []))];
  const connection = payload?.connection || "idle";
  const stale = payload?.stale || connection === "stale";

  function setFilter(name, value) {
    const next = new URLSearchParams(location.search);
    if (value) next.set(name, value);
    else next.delete(name);
    if (name === "account" || name === "audience") next.delete("panel");
    if (name === "audience") next.delete("account");
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

  async function removeMonitor(monitor) {
    const label = `${monitor.env || "monitor"} ${monitor.signal || ""}`.trim();
    if (!window.confirm(`Xoá monitor ${label}?\nBản ghi monitor_positions _id ${monitor.id}\nLệnh trên sàn không bị đóng.`)) return;
    try {
      await api(`/api/positions/monitors/${encodeURIComponent(monitor.id)}`, { method: "DELETE" });
      setPayload((prev) => prev && ({
        ...prev,
        rows: (prev.rows || []).map((row) => ({
          ...row,
          monitors: (row.monitors || []).filter((item) => item.id !== monitor.id),
        })),
      }));
      setError("");
      setActionNote("");
    } catch (err) {
      console.error("[positions]", err);
      setError(err.message || "Không xoá được monitor");
    }
  }

  return (
    <section className="stack pos-screen">
      <header>
        <h1>Position</h1>
        <p className="muted">Mỗi vị thế hai dòng. PnL mở = Size × (mark − entry). PnL ghi nhận lấy từ income Binance lúc mở trang và lúc bấm Cập nhật sàn. Size và entry lấy từ sổ sàn; khi chưa có sổ thì lấy bản monitor lưu lần cuối.</p>
      </header>
      <div className="history-tabs" role="tablist">
        <button type="button" className={tab === "open" ? "active" : ""} onClick={() => go((query) => { query.delete("tab"); query.delete("trade"); })}>Đang mở</button>
        {canHistory ? <button type="button" className={tab === "history" ? "active" : ""} onClick={() => go((query) => { query.set("tab", "history"); query.delete("panel"); })}>Lịch sử</button> : null}
      </div>
      <form className="signal-filters" onSubmit={(event) => event.preventDefault()}>
        <label>Phạm vi
          <select value={audience} onChange={(event) => setFilter("audience", event.target.value)}>
            <option value="mine">Của tôi</option>
            <option value="all">Có quyền xem</option>
          </select>
        </label>
        <label>Tài khoản
          <select value={account} onChange={(event) => setFilter("account", event.target.value)}>
            <option value="">Tất cả</option>
            {accountRows.map((item) => <option key={item.username} value={item.username}>{item.username}</option>)}
          </select>
        </label>
        <label>Config
          <select value={params.get("env") || ""} onChange={(event) => setFilter("env", event.target.value)}>
            <option value="">Tất cả</option>
            {envs.map((env) => <option key={env} value={env}>{env}</option>)}
          </select>
        </label>
        <label>Symbol
          <input value={params.get("symbol") || ""} placeholder="NEAR, BTC…" onChange={(event) => setFilter("symbol", event.target.value.toUpperCase())} />
        </label>
        <label>Signal
          <input value={params.get("signal") || ""} placeholder="GAU, ROSE…" onChange={(event) => setFilter("signal", event.target.value)} />
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
            <option value="">Live</option>
            <option value="paper">Paper</option>
            <option value="all">Live và paper</option>
            <option value="pending" disabled={tab === "history"}>Lệnh chờ</option>
            <option value="notpsl" disabled={tab === "history"}>NOTPSL</option>
          </select>
        </label>
        <button type="button" disabled={tab === "history" || refreshing} title={tab === "history" ? "Cập nhật sàn chỉ dùng cho vị thế đang mở" : ""} onClick={async () => {
          setRefreshing(true);
          try {
            const view = await api("/api/positions/refresh", { method: "POST", body: { account, audience, book }, timeoutMs: 60000 });
            setPayload((prev) => {
              const versions = new Map((prev?.sources || []).map((item) => [item.account, item.version]));
              if ((view.sources || []).some((item) => item.version != null && versions.get(item.account) != null && item.version < versions.get(item.account))) return prev;
              return view;
            });
            setError("");
          } catch (err) {
            console.error("[positions]", err);
            setError(err.message || "Không cập nhật được sổ sàn");
          } finally {
            setRefreshing(false);
          }
        }}>{refreshing ? "Đang cập nhật…" : "Cập nhật sàn"}</button>
        {canOpen && tab === "open" ? <button type="button" onClick={() => setDraft({ account: account || "", env: "", symbol: "", side: "LONG", signal: "NOTPSL", positionAmt: "" })}>Thêm monitor position</button> : null}
        <label>Bất thường
          <select value={params.get("warn") || ""} disabled={tab === "history"} title={tab === "history" ? "Cảnh báo chỉ áp cho vị thế đang mở" : ""} onChange={(event) => setFilter("warn", event.target.value)}>
            <option value="">Tất cả</option>
            <option value="1">Chỉ cảnh báo</option>
          </select>
        </label>
      </form>
      {tab === "history" ? <PositionHistory params={params} go={go} canStats={canHistory} onAccounts={setHistoryAccounts} /> : null}
      {tab === "open" && !canPositions ? <p className="muted">Cần quyền positions.view để xem vị thế đang mở.</p> : null}
      {tab === "open" && canPositions ? <><p className={stale ? "pos-status pos-stale" : "pos-status"}>
        {account
          ? (connection === "live" ? "Kết nối live" : connection === "polling" ? "Đang polling" : connection === "monitor" ? "Đang hiện monitor, chưa có snapshot live" : stale ? "Dữ liệu vị thế chưa được xác minh gần đây" : "Snapshot")
          : (stale ? "Dữ liệu vị thế chưa được xác minh gần đây" : "Live · các tài khoản được phép xem")}
        {payload?.priceFeed === "live" ? " · giá mark" : ""}
        {payload?.version != null ? ` · v${payload.version}` : ""}
        {payload?.updatedAt ? ` · đối chiếu sàn ${when(payload.updatedAt)}` : ""}
        {payload?.sources?.some((source) => source.stale) ? ` · cần đối chiếu: ${payload.sources.filter((source) => source.stale).map((source) => source.account).join(", ")}` : ""}
      </p>
      {actionNote ? <p className="muted">{actionNote}</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
      {payload?.exchangeErrors?.length ? <p className="form-error">{payload.exchangeErrors.map((item) => `${item.account}: ${item.error}`).join(" · ")}</p> : null}
      {!payload ? <p className="muted">Đang tải…</p> : null}
      {payload && !rows.length && !stale ? <p className="muted">Không có vị thế trong bộ lọc này.</p> : null}
      {payload && !rows.length && stale ? <p className="pos-stale">Chưa có snapshot mới. Không coi đây là hết vị thế.</p> : null}
      {rows.length ? (
        <div className="table-wrap">
          <table className="pos-table">
            <thead>
              <tr>
                <th />
                {POSITION_COLUMNS.map((column) => (
                  <th key={column.id} aria-sort={sort.key === column.id ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                    <button type="button" className="sort-col" title={column.title} onClick={() => toggleSort(column.id)}>
                      {column.label}{sort.key === column.id ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const roi = roiOf(row);
                const recordedFrom = row.recorded?.source === "positionHistory" ? "Position history" : row.recorded?.source === "trades" ? "Lệnh đóng" : row.recorded?.source === "income" ? "Income" : "Monitor";
                const recordedTitle = row.recorded
                  ? `${recordedFrom} · chốt ${fmt(row.recorded.realized, 2)} · fee ${fmt(row.recorded.fee, 2)} · funding ${fmt(row.recorded.funding, 2)}`
                  : "Chưa có position history, lệnh đóng hoặc stats";
                return (
                <Fragment key={row.key}>
                  <tr className={row.warnings.length ? "pos-alert" : ""}>
                    <td><button type="button" className="ghost" onClick={() => toggle(row.key)}>{open.has(row.key) ? "−" : "+"}</button></td>
                    <td>{row.account}</td>
                    <td>
                      <span className="pos-inline">
                        <button type="button" className="linkish" data-row={row.key} onClick={(event) => { setMonitorId(""); go((query) => query.set("panel", row.key), { layer: true }); event.currentTarget.blur(); }}>{row.symbol}</button>
                        <span className="muted">{row.side}{row.leverage == null ? "" : ` · ${fmt(row.leverage, 0)}x`}{row.notpsl ? " · NOTPSL" : ""}{row.book === "pending" ? " · lệnh chờ" : ""}</span>
                      </span>
                    </td>
                    <td>{qtyOf(row) == null ? "—" : fmt(qtyOf(row))}</td>
                    <td>{fmt(row.entry)}</td>
                    <td>{fmt(row.mark)}</td>
                    <td className={pnlClass(row.unrealized)} title="Size × (mark − entry)">
                      <span className="pos-inline">
                        <span>{row.unrealized == null ? "—" : fmt(row.unrealized, 2)}</span>
                        {roi == null ? null : <span>{roi > 0 ? "+" : ""}{fmt(roi, 2)}%</span>}
                      </span>
                    </td>
                    <td className={pnlClass(row.recorded?.net)} title={recordedTitle}>{row.recorded ? fmt(row.recorded.net, 2) : "—"}</td>
                    <td>{fmt(row.liquidation)}</td>
                    <td>{volumeOf(row) == null ? "—" : fmt(volumeOf(row), 2)}</td>
                  </tr>
                  <tr className={row.warnings.length ? "pos-sub pos-alert" : "pos-sub"}>
                    <td />
                    <td colSpan={9}>
                      <div className="pos-actions">
                        <button type="button" className="ghost" onClick={() => setActionNote(ACTION_NOTE)}>Market</button>
                        <button type="button" className="ghost" onClick={() => setActionNote(ACTION_NOTE)}>Limit</button>
                        <button type="button" className="ghost" onClick={() => setActionNote(ACTION_NOTE)}>Reverse</button>
                        <span>{tpslText(row)}</span>
                        <button type="button" className="ghost" onClick={() => { setMonitorId(row.monitors[0]?.id || ""); go((query) => query.set("panel", row.key), { layer: true }); }}>Add</button>
                        {canOpen ? <button type="button" className="ghost" onClick={() => setDraft({ account: row.account, env: "", symbol: row.symbol, side: row.side, signal: "NOTPSL", positionAmt: qtyOf(row) ?? "", entry: row.entry ?? "", mark: row.mark ?? "", leverage: row.leverage ?? "", liquidation: row.liquidation ?? "" })}>Thêm monitor</button> : null}
                        {canClose ? row.monitors.map((monitor) => (
                          <button key={monitor.id} type="button" className="ghost" title={`Xoá monitor_positions _id ${monitor.id}. Không đóng lệnh sàn.`} onClick={() => removeMonitor(monitor)}>Xoá monitor {monitor.env} {monitor.signal || monitor.type || ""}</button>
                        )) : null}
                        {row.warnings.length ? <span className="muted">{row.warnings.map((item) => WARN[item] || item).join(" · ")}</span> : null}
                      </div>
                    </td>
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
                </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}</> : null}
      {draft ? (
        <div className="modal-backdrop" onClick={() => { if (!saving) setDraft(null); }}>
          <form className="modal-card stack" onClick={(event) => event.stopPropagation()} onSubmit={async (event) => {
            event.preventDefault();
            setSaving(true);
            try {
              const created = await api("/api/positions/monitors", { method: "POST", body: draft });
              setPayload((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  rows: (prev.rows || []).map((row) => {
                    if (row.account !== created.account || row.symbol !== created.symbol || row.side !== created.side) return row;
                    return {
                      ...row,
                      notpsl: row.notpsl || created.row?.notpsl,
                      warnings: (row.warnings || []).filter((item) => item !== "no-monitor"),
                      monitors: [...(row.monitors || []), created.row],
                    };
                  }),
                };
              });
              setActionNote(created.monitorOff ? `Đã thêm monitor ${created.env} ${created.signal}. Config đang tắt MONITOR nên bot sẽ không chạy monitor này.` : `Đã thêm monitor ${created.env} ${created.signal}. Bot nhận ở vòng kiểm tra monitor kế tiếp.`);
              setDraft(null);
              setError("");
            } catch (err) {
              console.error("[positions]", err);
              setError(err.message || "Không thêm được monitor");
            } finally {
              setSaving(false);
            }
          }}>
            <header>
              <h2>Thêm monitor position</h2>
              <button type="button" onClick={() => setDraft(null)}>Đóng</button>
            </header>
            <p className="muted">Tạo bản ghi monitor. Không mở thêm lệnh trên sàn. Bot nhận bản ghi ở vòng kiểm tra kế tiếp và dùng trade config của env.</p>
            <label>Tài khoản
              <select value={draft.account} onChange={(event) => setDraft({ ...draft, account: event.target.value, env: "" })} required>
                <option value="">Chọn</option>
                {(payload?.accounts || []).map((item) => <option key={item.username} value={item.username}>{item.username}</option>)}
              </select>
            </label>
            <label>Config
              <select value={draft.env} onChange={(event) => setDraft({ ...draft, env: event.target.value })} required>
                <option value="">Chọn</option>
                {((payload?.accounts || []).find((item) => item.username === draft.account)?.accounts || []).map((env) => <option key={env} value={env}>{env}</option>)}
              </select>
            </label>
            <label>Symbol
              <input value={draft.symbol} onChange={(event) => setDraft({ ...draft, symbol: event.target.value.toUpperCase() })} required />
            </label>
            <label>Side
              <select value={draft.side} onChange={(event) => setDraft({ ...draft, side: event.target.value })}>
                <option value="LONG">LONG</option>
                <option value="SHORT">SHORT</option>
              </select>
            </label>
            <label>Signal
              <input value={draft.signal} onChange={(event) => setDraft({ ...draft, signal: event.target.value })} />
            </label>
            <button type="submit" disabled={saving}>{saving ? "Đang lưu…" : "Thêm monitor"}</button>
          </form>
        </div>
      ) : null}
      {tab === "open" && panel && selected ? (
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
