import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import Pager from "./Pager";

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

function dateValue(date) {
    if (!date) return "";
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
}

const ORDER_TYPE_LABELS = {
    LIMIT: "Limit",
    MARKET: "Market",
    STOP: "Stop Limit",
    STOP_MARKET: "Stop Market",
    TAKE_PROFIT: "TP Limit",
    TAKE_PROFIT_MARKET: "TP Market",
    TRAILING_STOP_MARKET: "Trailing Stop",
};

function typeLabel(type) {
    return ORDER_TYPE_LABELS[type] || type;
}

function statusClass(status) {
    if (status === "FILLED") return "order-status-filled";
    if (status === "CANCELED" || status === "EXPIRED") return "order-status-canceled";
    if (status === "NEW" || status === "PARTIALLY_FILLED") return "order-status-open";
    return "";
}

function sideClass(side, positionSide) {
    if (positionSide === "LONG") return "order-long";
    if (positionSide === "SHORT") return "order-short";
    if (side === "BUY") return "order-long";
    if (side === "SELL") return "order-short";
    return "";
}

const RANGE_OPTIONS = [
    { value: "today", label: "Hôm nay" },
    { value: "7", label: "7 ngày" },
    { value: "30", label: "30 ngày" },
    { value: "90", label: "90 ngày" },
    { value: "custom", label: "Tùy chọn" },
];

function rangeToQuery(range, customFrom, customTo) {
    if (range === "custom") {
        return { from: customFrom || undefined, to: customTo || undefined };
    }
    const now = new Date();
    const to = new Date(now);
    to.setHours(23, 59, 59, 999);

    let from;
    if (range === "today") {
        from = new Date(now);
        from.setHours(0, 0, 0, 0);
    } else {
        const days = parseInt(range, 10) || 7;
        from = new Date(now);
        from.setDate(from.getDate() - days);
        from.setHours(0, 0, 0, 0);
    }

    return { from: from.toISOString(), to: to.toISOString() };
}

export default function OrderHistoryTab({ params, go, accounts: parentAccounts }) {
    const [payload, setPayload] = useState(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [detail, setDetail] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);

    const account = params.get("account") || "";
    const audience = params.get("audience") === "all" ? "all" : "mine";
    const range = params.get("range") || "7";
    const customFrom = params.get("from") || "";
    const customTo = params.get("to") || "";
    const page = parseInt(params.get("page"), 10) || 1;

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const query = new URLSearchParams();
            query.set("audience", audience);
            if (account) query.set("account", account);

            const symbol = params.get("symbol") || "";
            if (symbol) query.set("symbol", symbol);

            const kind = params.get("orderKind") || "";
            if (kind) query.set("kind", kind);

            const side = params.get("orderSide") || "";
            if (side) query.set("side", side);

            const status = params.get("orderStatus") || "";
            if (status) query.set("status", status);

            const type = params.get("orderType") || "";
            if (type) query.set("type", type);

            const { from, to } = rangeToQuery(range, customFrom, customTo);
            if (from) query.set("from", from);
            if (to) query.set("to", to);

            query.set("page", String(page));
            query.set("limit", "50");

            const result = await api(`/api/orders/history?${query}`);
            setPayload(result);
            setError("");
        } catch (err) {
            console.error("[orders]", err);
            setError(err.message || "Không tải được lịch sử order");
        } finally {
            setLoading(false);
        }
    }, [account, audience, params, range, customFrom, customTo, page]);

    useEffect(() => {
        load();
    }, [load]);

    const accounts = payload?.accounts || parentAccounts || [];

    function setFilter(name, value) {
        go((query) => {
            if (value) query.set(name, value);
            else query.delete(name);
            // Reset page when filter changes
            if (name !== "page") query.delete("page");
        });
    }

    async function loadDetail(order) {
        if (!order?.orderId || !order?.symbol || !order?.kind || !order?.username) return;
        setDetailLoading(true);
        setDetail(null);
        try {
            const result = await api(
                `/api/orders/${encodeURIComponent(order.kind)}/${encodeURIComponent(order.symbol)}/${encodeURIComponent(order.orderId)}?account=${encodeURIComponent(order.username)}`
            );
            setDetail(result);
        } catch (err) {
            console.error("[orders]", err);
            setDetail({ error: err.message || "Không tải được chi tiết" });
        } finally {
            setDetailLoading(false);
        }
    }

    return (
        <div className="orders-tab">
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
                        {accounts.map((item) => <option key={item.username} value={item.username}>{item.username}</option>)}
                    </select>
                </label>
                <label>Khoảng thời gian
                    <select value={range} onChange={(event) => setFilter("range", event.target.value)}>
                        {RANGE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>
                </label>
                {range === "custom" ? (
                    <>
                        <label>Từ
                            <input
                                type="date"
                                value={dateValue(customFrom)}
                                onChange={(event) => setFilter("from", event.target.value ? new Date(event.target.value).toISOString() : "")}
                            />
                        </label>
                        <label>Đến
                            <input
                                type="date"
                                value={dateValue(customTo)}
                                onChange={(event) => setFilter("to", event.target.value ? new Date(event.target.value + "T23:59:59").toISOString() : "")}
                            />
                        </label>
                    </>
                ) : null}
                <label>Symbol
                    <input
                        value={params.get("symbol") || ""}
                        placeholder="BTC, ETH…"
                        onChange={(event) => setFilter("symbol", event.target.value.toUpperCase())}
                    />
                </label>
                <label>Loại order
                    <select value={params.get("orderKind") || ""} onChange={(event) => setFilter("orderKind", event.target.value)}>
                        <option value="">Tất cả</option>
                        <option value="regular">Regular</option>
                        <option value="algo">Algo/Conditional</option>
                    </select>
                </label>
                <label>Side
                    <select value={params.get("orderSide") || ""} onChange={(event) => setFilter("orderSide", event.target.value)}>
                        <option value="">Tất cả</option>
                        <option value="BUY">Buy</option>
                        <option value="SELL">Sell</option>
                    </select>
                </label>
                <label>Trạng thái
                    <select value={params.get("orderStatus") || ""} onChange={(event) => setFilter("orderStatus", event.target.value)}>
                        <option value="">Tất cả</option>
                        <option value="FILLED">Filled</option>
                        <option value="CANCELED">Canceled</option>
                        <option value="EXPIRED">Expired</option>
                        <option value="NEW">New</option>
                        <option value="PARTIALLY_FILLED">Partially Filled</option>
                    </select>
                </label>
                <button type="button" disabled={loading} onClick={load}>
                    {loading ? "Đang tải…" : "Tìm kiếm"}
                </button>
            </form>

            {error ? <p className="form-error">{error}</p> : null}

            {loading && !payload ? <p className="muted">Đang tải…</p> : null}
            {payload && !payload.orders?.length ? <p className="muted">Không có order trong khoảng thời gian này.</p> : null}

            {payload?.orders?.length ? (
                <>
                    <div className="table-wrap">
                        <table className="pos-table orders-table">
                            <thead>
                                <tr>
                                    <th>Tài khoản</th>
                                    <th>Symbol</th>
                                    <th>Loại</th>
                                    <th>Side</th>
                                    <th>Type</th>
                                    <th>Giá</th>
                                    <th>Qty</th>
                                    <th>Filled</th>
                                    <th>Avg Price</th>
                                    <th>Trạng thái</th>
                                    <th>Thời gian</th>
                                </tr>
                            </thead>
                            <tbody>
                                {payload.orders.map((order) => (
                                    <tr
                                        key={`${order.username}-${order.kind}-${order.orderId}`}
                                        className={`${sideClass(order.side, order.positionSide)} clickable`}
                                        onClick={() => loadDetail(order)}
                                    >
                                        <td>{order.username}</td>
                                        <td>
                                            <span className="order-symbol">
                                                {order.symbol}
                                                <span className="muted"> · {order.positionSide}</span>
                                            </span>
                                        </td>
                                        <td>
                                            <span className={`order-kind order-kind-${order.kind}`}>
                                                {order.kind === "algo" ? "Algo" : "Regular"}
                                            </span>
                                        </td>
                                        <td className={order.side === "BUY" ? "order-buy" : "order-sell"}>
                                            {order.side}
                                        </td>
                                        <td>{typeLabel(order.type)}</td>
                                        <td>{fmt(order.price)}</td>
                                        <td>{fmt(order.origQty)}</td>
                                        <td>{fmt(order.executedQty)}</td>
                                        <td>{fmt(order.avgPrice)}</td>
                                        <td>
                                            <span className={`order-status ${statusClass(order.status)}`}>
                                                {order.status}
                                            </span>
                                        </td>
                                        <td>{when(order.updateTime || order.time)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <Pager
                        page={payload.page}
                        total={payload.total}
                        limit={payload.limit || 50}
                        onChange={(p) => setFilter("page", String(p))}
                    />
                </>
            ) : null}

            <p className="muted">
                Lịch sử order từ Mongo read model. Cần reconcile hoặc user stream để cập nhật.
            </p>

            {detail || detailLoading ? (
                <div className="modal-backdrop" onClick={() => setDetail(null)}>
                    <div className="modal-card" onClick={(event) => event.stopPropagation()}>
                        <header>
                            <h2>Chi tiết Order</h2>
                            <button type="button" onClick={() => setDetail(null)}>Đóng</button>
                        </header>
                        {detailLoading ? <p className="muted">Đang tải…</p> : null}
                        {detail?.error ? <p className="form-error">{detail.error}</p> : null}
                        {detail?.order ? (
                            <div className="order-detail">
                                <h3>Order</h3>
                                <dl>
                                    <dt>Order ID</dt>
                                    <dd>{detail.order.orderId}</dd>
                                    <dt>Client Order ID</dt>
                                    <dd>{detail.order.clientOrderId || "—"}</dd>
                                    <dt>Symbol</dt>
                                    <dd>{detail.order.symbol} · {detail.order.positionSide}</dd>
                                    <dt>Side</dt>
                                    <dd>{detail.order.side}</dd>
                                    <dt>Type</dt>
                                    <dd>{typeLabel(detail.order.type)}</dd>
                                    <dt>Giá</dt>
                                    <dd>{fmt(detail.order.price)}</dd>
                                    <dt>Trigger</dt>
                                    <dd>{fmt(detail.order.triggerPrice)}</dd>
                                    <dt>Qty</dt>
                                    <dd>{fmt(detail.order.origQty)}</dd>
                                    <dt>Filled</dt>
                                    <dd>{fmt(detail.order.executedQty)}</dd>
                                    <dt>Avg Price</dt>
                                    <dd>{fmt(detail.order.avgPrice)}</dd>
                                    <dt>Trạng thái</dt>
                                    <dd>{detail.order.status}</dd>
                                    <dt>Time in Force</dt>
                                    <dd>{detail.order.timeInForce || "—"}</dd>
                                    <dt>Working Type</dt>
                                    <dd>{detail.order.workingType || "—"}</dd>
                                    <dt>Reduce Only</dt>
                                    <dd>{detail.order.reduceOnly ? "Có" : "Không"}</dd>
                                    <dt>Close Position</dt>
                                    <dd>{detail.order.closePosition ? "Có" : "Không"}</dd>
                                    <dt>Tạo lúc</dt>
                                    <dd>{when(detail.order.time)}</dd>
                                    <dt>Cập nhật</dt>
                                    <dd>{when(detail.order.updateTime)}</dd>
                                </dl>

                                {detail.fills?.length ? (
                                    <>
                                        <h3>Fills ({detail.fills.length})</h3>
                                        <table className="pos-table">
                                            <thead>
                                                <tr>
                                                    <th>Trade ID</th>
                                                    <th>Giá</th>
                                                    <th>Qty</th>
                                                    <th>PnL</th>
                                                    <th>Fee</th>
                                                    <th>Thời gian</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {detail.fills.map((fill) => (
                                                    <tr key={fill.tradeId}>
                                                        <td>{fill.tradeId}</td>
                                                        <td>{fmt(fill.price)}</td>
                                                        <td>{fmt(fill.qty)}</td>
                                                        <td>{fmt(fill.realizedPnl, 2)}</td>
                                                        <td>{fmt(fill.commission, 4)} {fill.commissionAsset}</td>
                                                        <td>{when(fill.time)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </>
                                ) : (
                                    <p className="muted">Chưa có fill được ghi nhận.</p>
                                )}
                            </div>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </div>
    );
}
