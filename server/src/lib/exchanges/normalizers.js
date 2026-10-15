/**
 * Canonical position/order helpers + Redis snapshot migration read.
 */

const { displayNameOf, normalizeExchangeId } = require("./registry");

function toNum(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function toText(value) {
    if (value == null || value === "") return null;
    return String(value);
}

function positionIdentity({ account, exchange, instrumentId, symbol, side, positionIdx }) {
    const parts = [
        String(account || "").trim(),
        normalizeExchangeId(exchange || "unknown"),
        String(instrumentId || symbol || "").trim().toUpperCase(),
        String(side || "").trim().toUpperCase(),
    ];
    if (positionIdx != null && positionIdx !== "") parts.push(String(positionIdx));
    return parts.join("|");
}

/**
 * Canonical public position. Giữ field legacy Binance (positionAmt, …)
 * để buildPositionView / Redis cũ vẫn đọc được.
 */
function canonicalizePosition(input = {}) {
    const exchange = normalizeExchangeId(input.exchange || "unknown");
    const instrumentId = String(input.instrumentId || input.symbol || "").trim();
    const symbol = String(input.symbol || instrumentId || "").trim();
    const side = String(input.side || input.positionSide || "").toUpperCase();
    const quantityUnit = input.quantityUnit === "contracts" ? "contracts" : "base";
    const quantity = input.quantity != null ? String(input.quantity) : String(Math.abs(toNum(input.positionAmt)));
    const positionAmt = input.positionAmt != null
        ? String(input.positionAmt)
        : String(side === "SHORT" ? -Math.abs(toNum(quantity)) : Math.abs(toNum(quantity)));

    return {
        account: input.account || null,
        exchange,
        exchangeDisplay: input.exchangeDisplay || displayNameOf(exchange),
        symbol,
        instrumentId,
        side: side === "LONG" || side === "SHORT" || side === "BOTH" ? side : "BOTH",
        positionSide: input.positionSide || (side === "LONG" || side === "SHORT" ? side : "BOTH"),
        positionIdx: input.positionIdx != null && input.positionIdx !== "" ? Number(input.positionIdx) : null,
        quantity,
        quantityUnit,
        baseQuantity: input.baseQuantity != null ? String(input.baseQuantity) : null,
        notional: input.notional != null ? String(input.notional) : null,
        entryPrice: toText(input.entryPrice),
        markPrice: toText(input.markPrice),
        unrealizedPnl: toText(input.unrealizedPnl ?? input.unRealizedProfit),
        unRealizedProfit: toText(input.unRealizedProfit ?? input.unrealizedPnl),
        leverage: toText(input.leverage),
        marginMode: input.marginMode || input.marginType || null,
        marginType: input.marginType || input.marginMode || null,
        liquidationPrice: toText(input.liquidationPrice),
        positionAmt,
        source: input.source || null,
        at: input.at || null,
        version: input.version ?? null,
        updateTime: input.updateTime || null,
    };
}

function canonicalizeOrder(input = {}, kind = "regular") {
    const orderKind = kind === "conditional" || kind === "algo" ? "conditional" : "regular";
    const exchange = normalizeExchangeId(input.exchange || "unknown");
    const instrumentId = String(input.instrumentId || input.symbol || "").trim();
    return {
        account: input.account || null,
        exchange,
        exchangeDisplay: input.exchangeDisplay || displayNameOf(exchange),
        orderKind,
        kind: orderKind === "conditional" ? "algo" : "order",
        symbol: String(input.symbol || instrumentId || "").trim(),
        instrumentId,
        side: String(input.side || "").toUpperCase() || null,
        positionSide: String(input.positionSide || "BOTH").toUpperCase(),
        positionIdx: input.positionIdx != null && input.positionIdx !== "" ? Number(input.positionIdx) : null,
        orderId: toText(input.orderId || input.algoId || input.ordId),
        algoId: toText(input.algoId),
        type: input.type || input.orderType || input.ordType || null,
        price: toText(input.price),
        stopPrice: toText(input.stopPrice || input.triggerPrice || input.triggerPx),
        triggerPrice: toText(input.triggerPrice || input.stopPrice || input.triggerPx),
        triggerSource: input.triggerSource || null,
        callbackRate: toText(input.callbackRate),
        activationPrice: toText(input.activationPrice),
        quantity: toText(input.quantity || input.origQty || input.qty || input.sz),
        quantityUnit: input.quantityUnit === "contracts" ? "contracts" : "base",
        reduceOnly: input.reduceOnly === true || input.reduceOnly === "true",
        closePosition: input.closePosition === true || input.closePosition === "true" || input.closeOnTrigger === true,
        closeOnTrigger: input.closeOnTrigger === true,
        status: input.status || input.algoStatus || input.state || null,
        workingType: input.workingType || null,
        protectionMode: input.protectionMode || null,
        origQty: toText(input.origQty || input.quantity || input.qty || input.sz),
        source: input.source || null,
        at: input.at || null,
    };
}

/**
 * Migration read cho Redis wb:ex snapshot.
 * - algoOrders cũ → conditionalOrders
 * - thiếu exchange: chỉ mặc định binance khi accountExchange === binance
 * - non-binance thiếu exchange → invalid (caller phải reconcile)
 */
function migrateExchangeBook(raw, { accountExchange = null } = {}) {
    if (!raw || typeof raw !== "object") return { ok: false, reason: "empty", book: null };
    if (raw.source !== "exchange" || !Array.isArray(raw.positions)) {
        return { ok: false, reason: "invalid_shape", book: null };
    }

    // Không gọi normalizeExchangeId("") — hàm đó mặc định "binance" và sẽ làm
    // mọi sổ bybit/okex/aster bị exchange_mismatch khi caller chưa resolve UserApi.
    const accountEx =
        accountExchange != null && String(accountExchange).trim() !== ""
            ? normalizeExchangeId(accountExchange)
            : null;
    let exchange = raw.exchange ? normalizeExchangeId(raw.exchange) : null;
    let stale = false;
    let needsReconcile = false;

    if (!exchange) {
        // Legacy snapshots chỉ mặc định Binance khi account là binance hoặc chưa resolve.
        // Non-Binance (bybit/aster/okex) thiếu exchange → stale, phải reconcile.
        if (accountEx && accountEx !== "binance" && accountEx !== "unknown") {
            return { ok: false, reason: "missing_exchange", book: null, needsReconcile: true };
        }
        exchange = "binance";
    } else if (accountEx && accountEx !== "unknown" && exchange !== accountEx) {
        return { ok: false, reason: "exchange_mismatch", book: null, needsReconcile: true };
    }

    const conditionalOrders = Array.isArray(raw.conditionalOrders)
        ? raw.conditionalOrders
        : Array.isArray(raw.algoOrders)
            ? raw.algoOrders
            : [];

    const book = {
        ...raw,
        exchange,
        exchangeDisplay: raw.exchangeDisplay || displayNameOf(exchange),
        conditionalOrders,
        algoOrders: conditionalOrders,
        positions: (raw.positions || []).map((row) => canonicalizePosition({
            ...row,
            account: raw.account || row.account,
            exchange: row.exchange || exchange,
        })),
        openOrders: (raw.openOrders || []).map((row) => canonicalizeOrder({
            ...row,
            account: raw.account || row.account,
            exchange: row.exchange || exchange,
        }, "regular")),
        complete: raw.complete !== false,
        stale: Boolean(raw.stale) || stale,
        needsReconcile,
    };
    return { ok: true, book, needsReconcile };
}

function buildSnapshotEnvelope({
    account,
    exchange,
    positions = [],
    openOrders = [],
    conditionalOrders = [],
    balance = null,
    at = new Date().toISOString(),
    version = null,
    complete = true,
    source = "rest",
}) {
    const id = normalizeExchangeId(exchange);
    const cond = Array.isArray(conditionalOrders) ? conditionalOrders : [];
    return {
        source: "exchange",
        account: account || null,
        exchange: id,
        exchangeDisplay: displayNameOf(id),
        complete,
        at,
        version,
        positions,
        openOrders,
        conditionalOrders: cond,
        algoOrders: cond,
        balance,
        restSource: source,
    };
}

function floorToStep(value, step) {
    const amount = Number(value);
    const stepSize = Number(step);
    if (!(amount > 0) || !(stepSize > 0)) return null;
    const precision = Math.max(0, (String(step).split(".")[1] || "").length);
    const floored = Math.floor(amount / stepSize + 1e-12) * stepSize;
    if (!(floored > 0)) return null;
    return floored.toFixed(precision);
}

function roundContractsDown(value, step = 1) {
    return floorToStep(value, step);
}

module.exports = {
    toNum,
    toText,
    positionIdentity,
    canonicalizePosition,
    canonicalizeOrder,
    migrateExchangeBook,
    buildSnapshotEnvelope,
    floorToStep,
    roundContractsDown,
};
