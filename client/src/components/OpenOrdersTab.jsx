import { useCallback, useEffect, useMemo, useState } from "react";
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

export default function OpenOrdersTab({ params, go, accounts: parentAccounts, audience: parentAudience }) {
    const [payload, setPayload] = useState(null);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
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
            </form>

            {error ? <p className="form-error">{error}</p> : null}
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
                            </tr>
                        </thead>
                        <tbody>
                            {orders.map((order) => (
                                <tr key={`${order.username}-${order.kind}-${order.orderId}`} className={sideClass(order.side, order.positionSide)}>
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
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ) : null}

            <p className="muted">
                Tổng: {payload?.total || 0} order đang mở.
                {" "}Dữ liệu từ Redis snapshot, không phải từ sàn trực tiếp.
            </p>
        </div>
    );
}
