import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";

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

function warnLevel(level) {
  if (level === "error") return "pos-case-warn-error";
  if (level === "warn") return "pos-case-warn";
  return "muted";
}

function orderRows(protective) {
  return [...(protective?.exchangeOrders || []), ...(protective?.algoOrders || [])];
}

function defaultCloseSide(positionSide) {
  return positionSide === "SHORT" ? "BUY" : "SELL";
}

function monitorHasContent(monitor) {
  if (!monitor) return false;
  if ((monitor.expectedOrders || []).length) return true;
  if ((monitor.timeline || []).length) return true;
  if ((monitor.fillsHistory || []).length) return true;
  const s = monitor.statsView || {};
  return s.mfe != null || s.mae != null || s.maxProfit != null || (s.slMoves || 0) > 0;
}

export default function PositionCasePanel({ row, audience, onClose, selectedMonitorId, onSelectMonitor, onChanged, embedded = false, section = "all" }) {
  const { user } = useAuth();
  const canCancel = (user?.permissions || []).includes("orders.cancel");
  const canCreate = (user?.permissions || []).includes("orders.create");
  const canEdit = (user?.permissions || []).includes("orders.edit");

  const [caseBody, setCaseBody] = useState(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState({
    type: "LIMIT",
    side: defaultCloseSide(row?.side),
    quantity: "",
    price: "",
    triggerPrice: "",
    reduceOnly: true,
  });
  const autoReconcileKey = useRef("");
  const loadSeq = useRef(0);

  async function fetchCase() {
    return api(
      `/api/positions/case?account=${encodeURIComponent(row.account)}&symbol=${encodeURIComponent(row.symbol)}&side=${encodeURIComponent(row.side)}&audience=${encodeURIComponent(audience || "mine")}`
    );
  }

  async function fetchReconcile() {
    return api("/api/positions/case/reconcile", {
      method: "POST",
      body: {
        account: row.account,
        symbol: row.symbol,
        side: row.side,
        audience: audience || "mine",
      },
    });
  }

  async function load({ autoOrders = true } = {}) {
    if (!row?.account || !row?.symbol || !row?.side) return;
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      let body = await fetchCase();
      if (seq !== loadSeq.current) return;
      const key = `${row.account}|${row.symbol}|${row.side}`;
      const noOrders = !orderRows(body.protective).length;
      const hasExchange = body.exchange?.qty > 0;
      if (autoOrders && noOrders && hasExchange && autoReconcileKey.current !== key) {
        autoReconcileKey.current = key;
        setReconciling(true);
        try {
          body = await fetchReconcile();
        } catch (err) {
          console.error("[positionCase]", err);
          if (seq === loadSeq.current) setNote(err.message || "reconcile order thất bại");
        } finally {
          if (seq === loadSeq.current) setReconciling(false);
        }
      }
      if (seq !== loadSeq.current) return;
      setCaseBody(body);
      setError("");
      setDraft((prev) => ({
        ...prev,
        side: defaultCloseSide(row.side),
        quantity: body.exchange?.qty != null ? String(body.exchange.qty) : prev.quantity,
        price: body.exchange?.mark != null ? String(body.exchange.mark) : prev.price,
      }));
      if (!selectedMonitorId && body.monitors?.[0]?.id) onSelectMonitor?.(body.monitors[0].id);
    } catch (err) {
      console.error("[positionCase]", err);
      if (seq === loadSeq.current) setError(err.message || "Không tải được chi tiết position");
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }

  useEffect(() => {
    autoReconcileKey.current = "";
    setCaseBody(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.account, row?.symbol, row?.side, audience]);

  async function reconcile() {
    setReconciling(true);
    try {
      const body = await fetchReconcile();
      setCaseBody(body);
      setError("");
      setNote(orderRows(body.protective).length ? "Đã đối chiếu sổ + order từ Binance" : "Đã đối chiếu — không có order mở");
      onChanged?.();
    } catch (err) {
      console.error("[positionCase]", err);
      setError(err.message || "Reconcile thất bại");
    } finally {
      setReconciling(false);
    }
  }

  async function cancelOrder(order) {
    if (!canCancel) {
      setError("Thiếu quyền orders.cancel");
      return;
    }
    const id = String(order.id);
    setBusyId(id);
    try {
      await api("/api/trading/orders/cancel", {
        method: "POST",
        body: {
          username: row.account,
          kind: order.kind === "algo" ? "algo" : "regular",
          symbol: row.symbol,
          orderId: id,
        },
      });
      setNote(`Đã huỷ ${order.kind} #${id}`);
      await load({ autoOrders: false });
      await reconcile();
      onChanged?.();
    } catch (err) {
      console.error("[positionCase]", err);
      setError(err.message || "Không huỷ được order");
    } finally {
      setBusyId("");
    }
  }

  function startEdit(order) {
    if (!canEdit && !canCancel) {
      setError("Thiếu quyền orders.edit / orders.cancel");
      return;
    }
    setEditing({
      id: String(order.id),
      kind: order.kind === "algo" ? "algo" : "regular",
      type: order.type || "LIMIT",
      side: order.side || defaultCloseSide(row.side),
      positionSide: order.positionSide || row.side,
      quantity: order.qty != null ? String(order.qty) : "",
      price: order.price != null ? String(order.price) : "",
      triggerPrice: order.stopPrice != null ? String(order.stopPrice) : "",
      reduceOnly: order.reduceOnly === true,
      closePosition: order.closePosition === true,
    });
  }

  async function saveEdit() {
    if (!editing) return;
    if (!canEdit) {
      setError("Thiếu quyền orders.edit");
      return;
    }
    setBusyId(editing.id);
    try {
      await api(`/api/trading/orders/${encodeURIComponent(editing.kind)}/${encodeURIComponent(row.symbol)}/${encodeURIComponent(editing.id)}`, {
        method: "PUT",
        body: {
          username: row.account,
          kind: editing.kind,
          side: editing.side,
          positionSide: editing.positionSide,
          type: editing.type,
          quantity: editing.closePosition ? undefined : editing.quantity,
          price: editing.price || undefined,
          triggerPrice: editing.triggerPrice || editing.price || undefined,
          reduceOnly: editing.reduceOnly,
          closePosition: editing.closePosition,
        },
      });
      setNote(`Đã sửa order #${editing.id} (huỷ + đặt lại)`);
      setEditing(null);
      await reconcile();
      onChanged?.();
    } catch (err) {
      console.error("[positionCase]", err);
      setError(err.message || "Không sửa được order");
    } finally {
      setBusyId("");
    }
  }

  async function placeQuick() {
    if (!canCreate) {
      setError("Thiếu quyền orders.create");
      return;
    }
    if (!(Number(draft.quantity) > 0) && draft.type !== "STOP_MARKET") {
      setError("Quantity phải > 0");
      return;
    }
    if (draft.type === "LIMIT" && !(Number(draft.price) > 0)) {
      setError("Limit cần giá");
      return;
    }
    if ((draft.type === "STOP_MARKET" || draft.type === "STOP") && !(Number(draft.triggerPrice) > 0)) {
      setError("Stop cần trigger");
      return;
    }
    setBusyId("new");
    try {
      const body = {
        username: row.account,
        symbol: row.symbol,
        side: draft.side,
        positionSide: row.side,
        type: draft.type,
        quantity: draft.quantity,
        reduceOnly: draft.reduceOnly,
      };
      if (draft.type === "LIMIT") body.price = draft.price;
      if (draft.type === "STOP" || draft.type === "STOP_MARKET") {
        body.triggerPrice = draft.triggerPrice;
        if (draft.type === "STOP") body.price = draft.price || draft.triggerPrice;
        else body.price = draft.triggerPrice;
      }
      const result = await api("/api/trading/orders", { method: "POST", body });
      const orderId = result?.command?.result?.orderId || result?.command?.result?.algoId;
      setNote(`Đã đặt ${draft.type} ${draft.side}${orderId ? ` · #${orderId}` : ""}`);
      await reconcile();
      onChanged?.();
    } catch (err) {
      console.error("[positionCase]", err);
      setError(err.message || "Không đặt được order");
    } finally {
      setBusyId("");
    }
  }

  const summary = caseBody?.ownershipSummary;
  const exchange = caseBody?.exchange;
  // Khớp monitor với đúng vị thế đang chọn trên bảng (tránh zombie/trùng env hiện thừa).
  const feedMonitorIds = useMemo(
    () => new Set((row?.monitors || []).map((item) => String(item.id)).filter(Boolean)),
    [row?.monitors]
  );
  const monitors = useMemo(() => {
    const fromCase = caseBody?.monitors || [];
    if (!feedMonitorIds.size) return fromCase;
    const matched = fromCase.filter((item) => feedMonitorIds.has(String(item.id)));
    return matched.length ? matched : fromCase;
  }, [caseBody?.monitors, feedMonitorIds]);
  const ownership = useMemo(() => {
    const fromCase = caseBody?.ownership || [];
    if (!feedMonitorIds.size) return fromCase;
    const matched = fromCase.filter((item) => feedMonitorIds.has(String(item.id)));
    if (matched.length) return matched;
    // Case chưa có / lệch id — fallback từ feed của đúng symbol.
    if (!(row?.monitors || []).length) return fromCase;
    return (row.monitors || [])
      .filter((item) => !item.paper && !item.pending && !item.closed && Number(item.ownQty) > 0)
      .map((item) => ({
        id: item.id,
        env: item.env,
        signal: item.signal || item.type,
        ownQty: item.ownQty,
        entry: item.entry,
        share: exchange?.qty > 0 ? Number(item.ownQty) / exchange.qty : null,
        notpsl: item.notpsl,
        watching: item.watching,
        tp: item.tp,
        sl: item.sl,
        trailing: item.trailing,
      }));
  }, [caseBody?.ownership, feedMonitorIds, row?.monitors, exchange?.qty]);
  const selected = monitors.find((item) => item.id === selectedMonitorId) || monitors[0];
  const showMonitor = monitorHasContent(selected);
  const openOrders = useMemo(() => orderRows(caseBody?.protective), [caseBody]);
  const history = caseBody?.orderHistory || [];

  // Monitor tab gộp luôn Timeline (không còn tab Timeline riêng).
  const visible = (name) => !embedded || section === "all" || section === name
    || (section === "monitor" && name === "timeline");

  return (
    <div className={embedded ? "term-case-inline" : "modal-backdrop"} onClick={embedded ? undefined : onClose}>
      <div className={embedded ? "stack term-case-content" : "modal-card stack pos-case-panel"} role={embedded ? "region" : "dialog"} aria-modal={embedded ? undefined : "true"} aria-labelledby="pos-case-title" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2 id="pos-case-title">{embedded ? ({ orders: "Lệnh liên quan", monitor: "Monitor · phân bổ · timeline", timeline: "Monitor · phân bổ · timeline" }[section] || "Chi tiết") : `${row.account} · ${row.symbol} · ${row.side}`}</h2>
          <div className="pos-inline">
            <button type="button" className="ghost" disabled={loading || reconciling} onClick={() => load({ autoOrders: false })}>Tải lại</button>
            <button type="button" className="pos-tpsl-confirm" disabled={reconciling || loading} onClick={reconcile}>
              {reconciling ? "Đang reconcile…" : "Reconcile an toàn"}
            </button>
            {!embedded ? <button type="button" onClick={onClose}>Đóng</button> : null}
          </div>
        </header>

        {!embedded ? <p className="muted">
          Chi tiết vị thế: sổ sàn, order (huỷ/sửa/thêm), ownership monitor đang mở, lịch sử order.
          Reconcile chỉ refresh Binance REST — không đóng vị thế.
        </p> : null}

        {error ? <p className="form-error">{error}</p> : null}
        {note ? <p className="form-ok">{note}</p> : null}
        {loading && !caseBody ? <p className="muted">Đang tải chi tiết…</p> : null}

        {caseBody ? (
          <>
            {visible("overview") ? <section className="pos-case-grid">
              <article>
                <h3>Sàn</h3>
                <ul className="pos-case-list">
                  <li>Qty: <strong>{fmt(exchange?.qty)}</strong></li>
                  <li>Entry TB sàn: <strong>{fmt(exchange?.entry)}</strong></li>
                  <li>Mark: {fmt(exchange?.mark)}</li>
                  <li className={pnlClass(exchange?.unrealized)}>PnL: {fmt(exchange?.unrealized, 2)}</li>
                  <li>Lev / Liq: {fmt(exchange?.leverage, 0)}x · {fmt(exchange?.liquidation)}</li>
                </ul>
              </article>
              <article>
                <h3>TP / SL / Trail</h3>
                <ul className="pos-case-list">
                  <li>TP: <strong>{fmt(caseBody.protective?.exchangeTp)}</strong></li>
                  <li>SL: <strong>{fmt(caseBody.protective?.exchangeSl)}</strong></li>
                  <li>Trailing: {caseBody.protective?.exchangeTrailingCallback != null ? `${fmt(caseBody.protective.exchangeTrailingCallback, 2)}%` : "—"}</li>
                  <li>Redis age: {caseBody.redis?.ageMs != null ? `${Math.round(caseBody.redis.ageMs / 1000)}s` : "—"}</li>
                </ul>
              </article>
              <article>
                <h3>Ownership</h3>
                <ul className="pos-case-list">
                  <li>Monitor mở: <strong>{summary?.configCount ?? 0}</strong>{summary?.sibling ? " · sibling" : ""}</li>
                  <li>Σ qty config: <strong>{fmt(summary?.ownQtySum)}</strong></li>
                  <li>Leftover sàn: <strong className={summary?.leftover > 0 ? "pos-down" : ""}>{fmt(summary?.leftover)}</strong></li>
                  <li>NOTPSL: {summary?.notpslCount ?? 0}</li>
                  <li>Heartbeat: {caseBody.heartbeat?.ok ? "OK" : "yếu/mất"}</li>
                </ul>
              </article>
            </section> : null}

            {visible("orders") ? <section className="pos-case-orders">
              <h3>Order sàn đang mở</h3>
              <p className="muted">{openOrders.filter((o) => o.kind !== "algo").length} thường · {openOrders.filter((o) => o.kind === "algo").length} algo</p>
              <div className="table-wrap">
                <table className="pos-table orders-table">
                  <thead>
                    <tr>
                      <th>Loại</th>
                      <th>Type</th>
                      <th>Side</th>
                      <th>Giá / Trigger</th>
                      <th>Qty</th>
                      <th>Status</th>
                      <th>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openOrders.map((order) => {
                      const id = String(order.id);
                      const isEdit = editing?.id === id;
                      return (
                        <tr key={`${order.kind}-${id}`} className={order.positionSide === "SHORT" || order.side === "SELL" ? "order-short" : "order-long"}>
                          <td><span className={`order-kind order-kind-${order.kind}`}>{order.kind === "algo" ? "Algo" : "Regular"}</span></td>
                          <td>{isEdit ? (
                            <select value={editing.type} onChange={(e) => setEditing({ ...editing, type: e.target.value })}>
                              <option value="LIMIT">LIMIT</option>
                              <option value="STOP_MARKET">STOP_MARKET</option>
                              <option value="STOP">STOP</option>
                              <option value="TAKE_PROFIT_MARKET">TAKE_PROFIT_MARKET</option>
                              <option value="TAKE_PROFIT">TAKE_PROFIT</option>
                            </select>
                          ) : (order.type || "—")}</td>
                          <td className={order.side === "BUY" ? "order-buy" : "order-sell"}>
                            {order.side} · {order.positionSide || "BOTH"}
                          </td>
                          <td>
                            {isEdit ? (
                              <span className="pos-case-inline-inputs">
                                <input inputMode="decimal" placeholder="Giá" value={editing.price} onChange={(e) => setEditing({ ...editing, price: e.target.value })} />
                                <input inputMode="decimal" placeholder="Trigger" value={editing.triggerPrice} onChange={(e) => setEditing({ ...editing, triggerPrice: e.target.value })} />
                              </span>
                            ) : (
                              <>
                                {fmt(order.price)}
                                {order.stopPrice != null && order.stopPrice !== order.price ? ` / ${fmt(order.stopPrice)}` : ""}
                                {order.callbackRate != null ? ` · trail ${fmt(order.callbackRate, 2)}%` : ""}
                              </>
                            )}
                          </td>
                          <td>
                            {isEdit ? (
                              <input inputMode="decimal" value={editing.quantity} onChange={(e) => setEditing({ ...editing, quantity: e.target.value })} />
                            ) : fmt(order.qty)}
                          </td>
                          <td>{order.status || "—"}</td>
                          <td className="pos-case-actions">
                            {isEdit ? (
                              <>
                                <button type="button" className="ghost" disabled={busyId === id} onClick={saveEdit}>{busyId === id ? "…" : "Lưu"}</button>
                                <button type="button" className="ghost" disabled={busyId === id} onClick={() => setEditing(null)}>Huỷ sửa</button>
                              </>
                            ) : (
                              <>
                                {(canEdit || canCancel) ? (
                                  <button type="button" className="ghost" disabled={!!busyId} onClick={() => startEdit(order)}>Sửa</button>
                                ) : null}
                                {canCancel ? (
                                  <button type="button" className="ghost order-cancel-btn" disabled={!!busyId} onClick={() => cancelOrder(order)}>
                                    {busyId === id ? "…" : "Huỷ"}
                                  </button>
                                ) : null}
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {!openOrders.length && !canCreate ? (
                      <tr><td colSpan={7} className="muted">Không có order mở — bấm Reconcile nếu vừa đặt trên sàn.</td></tr>
                    ) : null}
                    {canCreate ? (
                      <tr className="pos-case-quick-row">
                        <td><span className="order-kind order-kind-order">Mới</span></td>
                        <td>
                          <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>
                            <option value="LIMIT">LIMIT</option>
                            <option value="MARKET">MARKET</option>
                            <option value="STOP_MARKET">STOP_MARKET</option>
                            <option value="STOP">STOP</option>
                          </select>
                        </td>
                        <td>
                          <select value={draft.side} onChange={(e) => setDraft({ ...draft, side: e.target.value })}>
                            <option value="BUY">BUY</option>
                            <option value="SELL">SELL</option>
                          </select>
                          <span className="muted"> · {row.side}</span>
                        </td>
                        <td>
                          <span className="pos-case-inline-inputs">
                            {(draft.type === "LIMIT" || draft.type === "STOP") ? (
                              <input inputMode="decimal" placeholder="Giá" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
                            ) : null}
                            {(draft.type === "STOP" || draft.type === "STOP_MARKET") ? (
                              <input inputMode="decimal" placeholder="Trigger" value={draft.triggerPrice} onChange={(e) => setDraft({ ...draft, triggerPrice: e.target.value })} />
                            ) : null}
                            {draft.type === "MARKET" ? <span className="muted">market</span> : null}
                          </span>
                        </td>
                        <td>
                          <input inputMode="decimal" placeholder="Qty" value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: e.target.value })} />
                        </td>
                        <td>
                          <label className="pos-case-check">
                            <input type="checkbox" checked={draft.reduceOnly} onChange={(e) => setDraft({ ...draft, reduceOnly: e.target.checked })} />
                            RO
                          </label>
                        </td>
                        <td className="pos-case-actions">
                          <button type="button" className="pos-tpsl-confirm" disabled={busyId === "new"} onClick={placeQuick}>
                            {busyId === "new" ? "…" : "Thêm"}
                          </button>
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section> : null}

            {embedded && (section === "monitor" || section === "timeline") && monitors.length ? (
              <label>Monitor
                <select value={selected?.id || ""} onChange={(event) => onSelectMonitor?.(event.target.value)}>
                  {monitors.map((item) => <option key={item.id} value={item.id}>{item.env || "Config"} · {item.signal || item.type || "—"}</option>)}
                </select>
              </label>
            ) : null}
            {embedded && (section === "monitor" || section === "timeline") && !monitors.length ? <p className="muted">Không có monitor cho vị thế này.</p> : null}

            {visible("monitor") && ownership.length ? (
              <section>
                <h3>Config sở hữu quantity</h3>
                <p className="muted">{row?.symbol} · {row?.side} · {ownership.length} config</p>
                <div className="table-wrap">
                  <table className="pos-table">
                    <thead>
                      <tr>
                        <th>Config</th>
                        <th>Signal</th>
                        <th>Qty riêng</th>
                        <th>Share</th>
                        {!embedded ? <th>Entry riêng</th> : null}
                        <th>TP/SL</th>
                        {!embedded ? <th>Flags</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {ownership.map((item) => (
                        <tr key={item.id} className={selectedMonitorId === item.id ? "pos-alert" : ""}>
                          <td>
                            <button type="button" className="linkish" onClick={() => onSelectMonitor?.(item.id)}>{item.env || "—"}</button>
                          </td>
                          <td>{item.signal || "—"}</td>
                          <td>{fmt(item.ownQty)}</td>
                          <td>{item.share == null ? "—" : `${fmt(item.share * 100, 1)}%`}</td>
                          {!embedded ? <td>{fmt(item.entry)}</td> : null}
                          <td>TP {item.tp || "—"} / SL {item.sl || "—"}{item.trailing ? ` · trail ${item.trailing}` : ""}</td>
                          {!embedded ? (
                            <td>
                              {item.notpsl ? "NOTPSL " : ""}
                              {item.watching ? "watching" : "no-hb"}
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="muted">Entry TB sàn {fmt(summary?.exchangeEntry)} · Entry TB theo qty config {fmt(summary?.avgEntryConfigs)}</p>
              </section>
            ) : null}

            {visible("monitor") && showMonitor ? (
              <section className="pos-case-monitor">
                <h3>Monitor {selected.env} · {selected.signal || selected.type || "—"}</h3>
                <div className="pos-case-grid">
                  <article>
                    <h4>Stats / MAE·MFE</h4>
                    <ul className="pos-case-list">
                      <li>MFE (max ROE): {fmt(selected.statsView?.mfe, 2)}%</li>
                      <li>MAE (min ROE): {fmt(selected.statsView?.mae, 2)}%</li>
                      <li>Max profit: {fmt(selected.statsView?.maxProfit, 2)}</li>
                      <li>Max drawdown: {fmt(selected.statsView?.maxDrawdown, 2)}</li>
                      <li>Dời SL: {selected.events?.slMove ?? selected.statsView?.slMoves ?? 0}</li>
                      <li>HP moves: {selected.statsView?.hpMoves ?? 0}</li>
                    </ul>
                  </article>
                  {(selected.expectedOrders || []).length ? (
                    <article>
                      <h4>Order dự kiến monitor</h4>
                      <ul className="pos-case-list">
                        {selected.expectedOrders.map((order) => (
                          <li key={`${order.kind}-${order.id}`}>
                            {order.kind}: {order.type} @ {fmt(order.price)} · qty {fmt(order.qty)}
                          </li>
                        ))}
                      </ul>
                    </article>
                  ) : null}
                </div>
              </section>
            ) : null}

            {visible("orders") ? <section>
              <h3>Lịch sử order (7 ngày)</h3>
              <div className="table-wrap">
                <table className="pos-table orders-table">
                  <thead>
                    <tr>
                      <th>Thời điểm</th>
                      <th>Loại</th>
                      <th>Type</th>
                      <th>Side</th>
                      <th>Giá / Trigger</th>
                      <th>Qty</th>
                      <th>Filled</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((order) => (
                      <tr key={`${order.kind}-${order.orderId}-${order.updateTime || order.time}`}>
                        <td>{when(order.updateTime || order.time)}</td>
                        <td><span className={`order-kind order-kind-${order.kind}`}>{order.kind === "algo" ? "Algo" : "Regular"}</span></td>
                        <td>{order.type || "—"}</td>
                        <td className={order.side === "BUY" ? "order-buy" : "order-sell"}>{order.side} · {order.positionSide}</td>
                        <td>{fmt(order.price)}{order.triggerPrice || order.stopPrice ? ` / ${fmt(order.triggerPrice || order.stopPrice)}` : ""}</td>
                        <td>{fmt(order.origQty)}</td>
                        <td>{fmt(order.executedQty)}</td>
                        <td>{order.status || "—"}</td>
                      </tr>
                    ))}
                    {!history.length ? <tr><td colSpan={8} className="muted">Chưa có lịch sử order (7 ngày gần nhất) cho symbol/side này.</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </section> : null}

            {embedded && (section === "monitor" || section === "timeline") && selected && !showMonitor && !(selected.timeline || []).length ? (
              <p className="muted">Monitor chưa có thống kê, lệnh dự kiến hoặc timeline.</p>
            ) : null}
            {embedded && (section === "monitor" || section === "timeline") && selected && showMonitor && !(selected.timeline || []).length ? (
              <p className="muted">Monitor này chưa có sự kiện timeline.</p>
            ) : null}
            {visible("timeline") && (selected?.timeline || []).length ? (
              <section className="pos-case-monitor">
                <h3>Timeline quyết định monitor</h3>
                <ol className="pos-case-timeline">
                  {selected.timeline.slice().reverse().slice(0, 40).map((item, index) => (
                    <li key={`${item.at}-${item.event}-${index}`}>
                      <span className="muted">{when(item.at)}</span>
                      {" · "}
                      <strong>{item.kind}</strong>
                      {item.phase ? ` · ${item.phase}` : ""}
                      {item.event ? ` · ${item.event}` : ""}
                      {item.message ? ` — ${item.message}` : ""}
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            {(caseBody.warnings || []).length ? (
              <section>
                <h3>Cảnh báo lệch</h3>
                <ul className="pos-case-list">
                  {caseBody.warnings.map((item) => (
                    <li key={`${item.code}-${item.env || ""}-${item.message}`} className={warnLevel(item.level)}>
                      [{item.level || "info"} · {item.code}] {item.message}
                    </li>
                  ))}
                </ul>
              </section>
            ) : (!embedded ? (
              <p className="muted">Không có cảnh báo lệch Mongo/Redis/runtime/sàn.</p>
            ) : null)}
          </>
        ) : null}
      </div>
    </div>
  );
}
