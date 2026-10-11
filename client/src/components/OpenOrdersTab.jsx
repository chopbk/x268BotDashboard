import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import OrderTicket from "./OrderTicket";

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

function sideClass(side, positionSide) {
    if (positionSide === "LONG") return "order-long";
    if (positionSide === "SHORT") return "order-short";
    if (side === "BUY") return "order-long";
    if (side === "SELL") return "order-short";
    return "";
}

export default function OpenOrdersTab({ params, go, accounts: parentAccounts }) {
    const { user } = useAuth();
    const canCancel = (user?.permissions || []).includes("orders.cancel");
    const canCreate = (user?.permissions || []).includes("orders.create");

    const [payload, setPayload] = useState(null);
    const [error, setError] = useState("");
    const [note, setNote] = useState("");
    const [loading, setLoading] = useState(false);
    const [cancelling, setCancelling] = useState("");
    const [batchBusy, setBatchBusy] = useState(false);
    const [selected, setSelected] = useState(() => new Set());
    const [confirmCancel, setConfirmCancel] = useState(null);

    const account = params.get("account") || "";
    const audience = params.get("audience") === "all" ? "all" : "mine";

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const query = new URLSearchParams();
            query.set("audience", audience);
            if (account) query.set("account", account);
            const result = await api(`/api/orders/open?${query}`);
            setPayload(result);
            setError("");
            setSelected(new Set());
        } catch (err) {
            console.error("[orders]", err);
            setError(err.message || "Không tải được danh sách order");
        } finally {
            setLoading(false);
        }
    }, [account, audience]);

    useEffect(() => {
        load();
    }, [load]);

    const orders = useMemo(() => {
        if (!payload?.orders) return [];
        const symbol = (params.get("symbol") || "").trim().toUpperCase();
        const kind = (params.get("orderKind") || "").trim().toLowerCase();
        const side = (params.get("orderSide") || "").trim().toUpperCase();
        const type = (params.get("orderType") || "").trim().toUpperCase();

        return payload.orders.filter((order) => {
            if (symbol && !String(order.symbol || "").toUpperCase().includes(symbol)) return false;
            if (kind && order.kind !== kind) return false;
            if (side && order.side !== side) return false;
            if (type && order.type !== type) return false;
            return true;
        });
    }, [payload, params]);

    const accounts = payload?.accounts || parentAccounts || [];

    function setFilter(name, value) {
        go((query) => {
            if (value) query.set(name, value);
            else query.delete(name);
        });
    }

    function rowKey(order) {
        return `${order.username}|${order.kind}|${order.symbol}|${order.orderId}`;
    }

    function toggleSelect(order) {
        const key = rowKey(order);
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }

    function toggleSelectAll() {
        if (selected.size === orders.length) {
            setSelected(new Set());
            return;
        }
        setSelected(new Set(orders.map(rowKey)));
    }

    async function runCancelOne(order) {
        const key = rowKey(order);
        setCancelling(key);
        try {
            const result = await api("/api/trading/orders/cancel", {
                method: "POST",
                body: {
                    username: order.username,
                    kind: order.kind === "algo" ? "algo" : "regular",
                    symbol: order.symbol,
                    orderId: String(order.orderId),
                },
            });
            setNote(
                result?.duplicate
                    ? `Huỷ ${order.symbol} #${order.orderId} trùng request trước`
                    : `Đã huỷ ${order.kind === "algo" ? "algo" : "order"} ${order.symbol} #${order.orderId}`
            );
            setError("");
            setConfirmCancel(null);
            await load();
        } catch (err) {
            console.error("[orders]", err);
            setError(err.message || "Không huỷ được lệnh");
        } finally {
            setCancelling("");
        }
    }

    async function runCancelBatch() {
        const picked = orders.filter((order) => selected.has(rowKey(order)));
        if (!picked.length) return;
        const byAccount = new Map();
        for (const order of picked) {
            if (!byAccount.has(order.username)) byAccount.set(order.username, []);
            byAccount.get(order.username).push({
                kind: order.kind === "algo" ? "algo" : "regular",
                symbol: order.symbol,
                orderId: String(order.orderId),
            });
        }
        setBatchBusy(true);
        try {
            let ok = 0;
            for (const [username, list] of byAccount) {
                const result = await api("/api/trading/orders/cancel-batch", {
                    method: "POST",
                    body: { username, orders: list },
                });
                const results = result?.command?.result?.results || [];
                ok += results.filter((row) => row.success).length || list.length;
            }
            setNote(`Đã gửi huỷ ${ok}/${picked.length} lệnh`);
            setError("");
            setConfirmCancel(null);
            await load();
        } catch (err) {
            console.error("[orders]", err);
            setError(err.message || "Không huỷ hàng loạt được");
        } finally {
            setBatchBusy(false);
        }
    }

    return (
        <div className="orders-layout">
            <OrderTicket
                accounts={accounts}
                defaultAccount={account || accounts[0]?.username || ""}
                canCreate={canCreate}
                onPlaced={() => load()}
            />

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
                    <label>Type
                        <select value={params.get("orderType") || ""} onChange={(event) => setFilter("orderType", event.target.value)}>
                            <option value="">Tất cả</option>
                            <option value="LIMIT">Limit</option>
                            <option value="MARKET">Market</option>
                            <option value="STOP">Stop Limit</option>
                            <option value="STOP_MARKET">Stop Market</option>
                            <option value="TAKE_PROFIT">TP Limit</option>
                            <option value="TAKE_PROFIT_MARKET">TP Market</option>
                            <option value="TRAILING_STOP_MARKET">Trailing</option>
                        </select>
                    </label>
                    <button type="button" disabled={loading} onClick={load}>
                        {loading ? "Đang tải…" : "Làm mới"}
                    </button>
                    {canCancel && selected.size ? (
                        <button
                            type="button"
                            className="danger"
                            disabled={batchBusy}
                            onClick={() => setConfirmCancel({ mode: "batch", count: selected.size })}
                        >
                            Huỷ đã chọn ({selected.size})
                        </button>
                    ) : null}
                </form>

                {error ? <p className="form-error">{error}</p> : null}
                {note ? <p className="form-ok">{note}</p> : null}
                {payload?.errors?.length ? (
                    <p className="form-error">
                        {payload.errors.map((item) => `${item.account}: ${item.error}`).join(" · ")}
                    </p>
                ) : null}

                {loading && !payload ? <p className="muted">Đang tải…</p> : null}
                {payload && !orders.length ? <p className="muted">Không có order đang mở.</p> : null}

                {orders.length ? (
                    <div className="table-wrap">
                        <table className="pos-table orders-table">
                            <thead>
                                <tr>
                                    {canCancel ? (
                                        <th className="orders-check">
                                            <input
                                                type="checkbox"
                                                checked={selected.size > 0 && selected.size === orders.length}
                                                onChange={toggleSelectAll}
                                                aria-label="Chọn tất cả"
                                            />
                                        </th>
                                    ) : null}
                                    <th>Tài khoản</th>
                                    <th>Symbol</th>
                                    <th>Loại</th>
                                    <th>Side</th>
                                    <th>Type</th>
                                    <th>Giá</th>
                                    <th>Trigger</th>
                                    <th>Qty</th>
                                    <th>Filled</th>
                                    <th>Trạng thái</th>
                                    <th>Thời gian</th>
                                    {canCancel ? <th>Thao tác</th> : null}
                                </tr>
                            </thead>
                            <tbody>
                                {orders.map((order) => {
                                    const key = rowKey(order);
                                    const busy = cancelling === key || batchBusy;
                                    return (
                                        <tr key={key} className={sideClass(order.side, order.positionSide)}>
                                            {canCancel ? (
                                                <td className="orders-check">
                                                    <input
                                                        type="checkbox"
                                                        checked={selected.has(key)}
                                                        onChange={() => toggleSelect(order)}
                                                        aria-label={`Chọn ${order.symbol} ${order.orderId}`}
                                                    />
                                                </td>
                                            ) : null}
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
                                            <td>{fmt(order.triggerPrice || order.stopPrice)}</td>
                                            <td>{fmt(order.origQty)}</td>
                                            <td>{fmt(order.executedQty)}</td>
                                            <td>
                                                <span className={`order-status order-status-${order.status?.toLowerCase()}`}>
                                                    {order.status}
                                                </span>
                                                {order.reduceOnly ? <span className="muted"> · Reduce</span> : null}
                                                {order.closePosition ? <span className="muted"> · Close</span> : null}
                                            </td>
                                            <td>{when(order.updateTime || order.time)}</td>
                                            {canCancel ? (
                                                <td>
                                                    <button
                                                        type="button"
                                                        className="ghost order-cancel-btn"
                                                        disabled={busy}
                                                        onClick={() => setConfirmCancel({ mode: "one", order })}
                                                    >
                                                        {cancelling === key ? "…" : "Huỷ"}
                                                    </button>
                                                </td>
                                            ) : null}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                ) : null}

                <p className="muted">
                    Tổng: {orders.length} / {payload?.total || 0} order đang mở.
                    {" "}Dữ liệu từ Redis; sau đặt/huỷ bấm Làm mới nếu chưa thấy đổi.
                </p>
            </div>

            {confirmCancel ? (
                <div className="modal-backdrop" role="presentation" onClick={() => !cancelling && !batchBusy && setConfirmCancel(null)}>
                    <div className="modal-card stack" role="dialog" aria-modal="true" aria-labelledby="cancel-order-title" onClick={(e) => e.stopPropagation()}>
                        <h2 id="cancel-order-title">
                            {confirmCancel.mode === "batch"
                                ? `Huỷ ${confirmCancel.count} lệnh đã chọn?`
                                : `Huỷ ${confirmCancel.order.kind === "algo" ? "algo" : "order"} ${confirmCancel.order.symbol}?`}
                        </h2>
                        {confirmCancel.mode === "one" ? (
                            <p className="muted">
                                {confirmCancel.order.username} · {confirmCancel.order.type} · #{confirmCancel.order.orderId}
                            </p>
                        ) : (
                            <p className="muted">Chỉ huỷ các dòng đang chọn trên bảng.</p>
                        )}
                        <div className="modal-actions">
                            <button type="button" className="ghost" disabled={!!cancelling || batchBusy} onClick={() => setConfirmCancel(null)}>
                                Đóng
                            </button>
                            <button
                                type="button"
                                className="danger"
                                disabled={!!cancelling || batchBusy}
                                onClick={() => (confirmCancel.mode === "batch" ? runCancelBatch() : runCancelOne(confirmCancel.order))}
                            >
                                {cancelling || batchBusy ? "Đang huỷ…" : "Xác nhận huỷ"}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
