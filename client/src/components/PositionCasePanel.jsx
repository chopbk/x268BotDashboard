import { useEffect, useState } from "react";
import { api } from "../api";

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

export default function PositionCasePanel({ row, audience, onClose, selectedMonitorId, onSelectMonitor }) {
  const [caseBody, setCaseBody] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [reconciling, setReconciling] = useState(false);

  async function load() {
    if (!row?.account || !row?.symbol || !row?.side) return;
    setLoading(true);
    try {
      const body = await api(
        `/api/positions/case?account=${encodeURIComponent(row.account)}&symbol=${encodeURIComponent(row.symbol)}&side=${encodeURIComponent(row.side)}&audience=${encodeURIComponent(audience || "mine")}`
      );
      setCaseBody(body);
      setError("");
      if (!selectedMonitorId && body.monitors?.[0]?.id) onSelectMonitor?.(body.monitors[0].id);
    } catch (err) {
      console.error("[positionCase]", err);
      setError(err.message || "Không tải được chi tiết position");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.account, row?.symbol, row?.side, audience]);

  async function reconcile() {
    setReconciling(true);
    try {
      const body = await api("/api/positions/case/reconcile", {
        method: "POST",
        body: {
          account: row.account,
          symbol: row.symbol,
          side: row.side,
          audience: audience || "mine",
        },
      });
      setCaseBody(body);
      setError("");
    } catch (err) {
      console.error("[positionCase]", err);
      setError(err.message || "Reconcile thất bại");
    } finally {
      setReconciling(false);
    }
  }

  const summary = caseBody?.ownershipSummary;
  const exchange = caseBody?.exchange;
  const selected = (caseBody?.monitors || []).find((item) => item.id === selectedMonitorId) || caseBody?.monitors?.[0];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card stack pos-case-panel" role="dialog" aria-modal="true" aria-labelledby="pos-case-title" onClick={(event) => event.stopPropagation()}>
        <header>
          <h2 id="pos-case-title">{row.account} · {row.symbol} · {row.side}</h2>
          <div className="pos-inline">
            <button type="button" className="ghost" disabled={loading || reconciling} onClick={load}>Tải lại</button>
            <button type="button" className="pos-tpsl-confirm" disabled={reconciling || loading} onClick={reconcile}>
              {reconciling ? "Đang reconcile…" : "Reconcile an toàn"}
            </button>
            <button type="button" onClick={onClose}>Đóng</button>
          </div>
        </header>

        <p className="muted">
          Màn hình đối chiếu Mongo monitor ↔ Redis ↔ runtime heartbeat ↔ sổ sàn.
          Reconcile chỉ refresh sổ từ Binance REST, không hủy order hay đóng vị thế.
        </p>

        {error ? <p className="form-error">{error}</p> : null}
        {loading && !caseBody ? <p className="muted">Đang tải chi tiết…</p> : null}

        {caseBody ? (
          <>
            <section className="pos-case-grid">
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
                <h3>Ownership / sibling</h3>
                <ul className="pos-case-list">
                  <li>Số config: <strong>{summary?.configCount ?? 0}</strong>{summary?.sibling ? " · sibling" : ""}</li>
                  <li>Σ qty config: <strong>{fmt(summary?.ownQtySum)}</strong></li>
                  <li>Leftover sàn: <strong className={summary?.leftover > 0 ? "pos-down" : ""}>{fmt(summary?.leftover)}</strong></li>
                  <li>Entry TB config: {fmt(summary?.avgEntryConfigs)}</li>
                  <li>NOTPSL: {summary?.notpslCount ?? 0}</li>
                  <li>Heartbeat: {caseBody.heartbeat?.ok ? "OK" : "yếu/mất"}</li>
                  <li>Redis: {caseBody.redis ? `${caseBody.redis.source || "—"} · age ${caseBody.redis.ageMs != null ? `${Math.round(caseBody.redis.ageMs / 1000)}s` : "—"}` : "không có"}</li>
                </ul>
              </article>
              <article>
                <h3>TP/SL sàn</h3>
                <ul className="pos-case-list">
                  <li>TP: {fmt(caseBody.protective?.exchangeTp)}</li>
                  <li>SL: {fmt(caseBody.protective?.exchangeSl)}</li>
                  <li>Trailing: {caseBody.protective?.exchangeTrailingCallback != null ? `${fmt(caseBody.protective.exchangeTrailingCallback, 2)}%` : "—"}</li>
                  <li>Orders: {(caseBody.protective?.exchangeOrders || []).length} thường · {(caseBody.protective?.algoOrders || []).length} algo</li>
                </ul>
              </article>
            </section>

            {(caseBody.warnings || []).length ? (
              <section>
                <h3>Cảnh báo lệch</h3>
                <ul className="pos-case-list">
                  {caseBody.warnings.map((item) => (
                    <li key={`${item.code}-${item.env || ""}-${item.message}`} className={warnLevel(item.level)}>
                      [{item.code}] {item.message}
                    </li>
                  ))}
                </ul>
              </section>
            ) : (
              <p className="muted">Không có cảnh báo lệch Mongo/Redis/runtime/sàn.</p>
            )}

            <section>
              <h3>Config sở hữu quantity</h3>
              <div className="table-wrap">
                <table className="pos-table">
                  <thead>
                    <tr>
                      <th>Config</th>
                      <th>Signal</th>
                      <th>Qty riêng</th>
                      <th>Share</th>
                      <th>Entry riêng</th>
                      <th>TP/SL monitor</th>
                      <th>Flags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(caseBody.ownership || []).map((item) => (
                      <tr key={item.id} className={selectedMonitorId === item.id ? "pos-alert" : ""}>
                        <td>
                          <button type="button" className="linkish" onClick={() => onSelectMonitor?.(item.id)}>{item.env || "—"}</button>
                        </td>
                        <td>{item.signal || "—"}</td>
                        <td>{fmt(item.ownQty)}</td>
                        <td>{item.share == null ? "—" : `${fmt(item.share * 100, 1)}%`}</td>
                        <td>{fmt(item.entry)}</td>
                        <td>TP {item.tp || "—"} / SL {item.sl || "—"}{item.trailing ? ` · trail ${item.trailing}` : ""}</td>
                        <td>
                          {item.notpsl ? "NOTPSL " : ""}
                          {item.watching ? "watching" : "no-hb"}
                        </td>
                      </tr>
                    ))}
                    {!(caseBody.ownership || []).length ? (
                      <tr><td colSpan={7}>Không có monitor — leftover/NOTPSL thuần sàn.</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <p className="muted">Entry TB sàn {fmt(summary?.exchangeEntry)} · Entry TB theo qty config {fmt(summary?.avgEntryConfigs)}</p>
            </section>

            {selected ? (
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
                      <li>DCA events: {selected.events?.dca ?? 0}</li>
                      <li>Partial close events: {selected.events?.partialClose ?? 0}</li>
                    </ul>
                  </article>
                  <article>
                    <h4>Order dự kiến monitor</h4>
                    <ul className="pos-case-list">
                      {(selected.expectedOrders || []).map((order) => (
                        <li key={`${order.kind}-${order.id}`}>
                          {order.kind}: {order.type} @ {fmt(order.price)} · qty {fmt(order.qty)}
                        </li>
                      ))}
                      {!(selected.expectedOrders || []).length ? <li className="muted">Chưa có TP/SL dự kiến trên monitor.</li> : null}
                    </ul>
                  </article>
                </div>

                <h4>Fills / DCA / partial</h4>
                <div className="table-wrap">
                  <table className="pos-table">
                    <thead>
                      <tr><th>Thời điểm</th><th>Kind</th><th>Qty</th><th>Giá</th><th>PnL</th><th>Fee</th></tr>
                    </thead>
                    <tbody>
                      {(selected.fillHistory || []).slice().reverse().map((fill, index) => (
                        <tr key={`${fill.at}-${index}`}>
                          <td>{when(fill.at)}</td>
                          <td>{fill.kind}</td>
                          <td>{fmt(fill.qty)}</td>
                          <td>{fmt(fill.price)}</td>
                          <td className={pnlClass(fill.realizedPnl)}>{fmt(fill.realizedPnl, 2)}</td>
                          <td>{fmt(fill.commission, 4)}</td>
                        </tr>
                      ))}
                      {!(selected.fillHistory || []).length ? <tr><td colSpan={6}>Chưa có fill ghi trên monitor.</td></tr> : null}
                    </tbody>
                  </table>
                </div>

                <h4>Timeline quyết định monitor</h4>
                <ol className="pos-case-timeline">
                  {(selected.timeline || []).slice().reverse().slice(0, 80).map((item, index) => (
                    <li key={`${item.at}-${item.event}-${index}`}>
                      <span className="muted">{when(item.at)}</span>
                      {" · "}
                      <strong>{item.kind}</strong>
                      {item.phase ? ` · ${item.phase}` : ""}
                      {item.event ? ` · ${item.event}` : ""}
                      {item.message ? ` — ${item.message}` : ""}
                    </li>
                  ))}
                  {!(selected.timeline || []).length ? <li className="muted">Chưa có openLogs/logs.</li> : null}
                </ol>
              </section>
            ) : null}

            <section>
              <h3>Order sàn đang mở (symbol)</h3>
              <ul className="pos-case-list">
                {[...(caseBody.protective?.exchangeOrders || []), ...(caseBody.protective?.algoOrders || [])].map((order) => (
                  <li key={`${order.kind}-${order.id}`}>
                    {order.kind} #{order.id} · {order.type} · {order.side} {order.positionSide}
                    {" · trigger "}{fmt(order.stopPrice || order.price)}
                    {order.callbackRate != null ? ` · cb ${fmt(order.callbackRate, 2)}%` : ""}
                    {" · "}{order.status}
                  </li>
                ))}
                {!(caseBody.protective?.exchangeOrders || []).length && !(caseBody.protective?.algoOrders || []).length ? (
                  <li className="muted">Không có order thường/algo cho symbol này trong sổ.</li>
                ) : null}
              </ul>
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
