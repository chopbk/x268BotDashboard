/**
 * Direct trading orchestration — mọi giao tiếp sàn qua getExchangeAdapter.
 * Chi tiết Binance/Bybit/Aster/OKX nằm trong adapter, không hard-code /fapi ở đây.
 */
const { httpError } = require("./http");
const { getExchangeAdapter } = require("./exchanges");

// Rate limit: tối đa 10 requests / 10s / exchange+account
const accountLastCall = new Map();
const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_MAX = 10;

function exactName(account) {
    return String(account || "").trim().toUpperCase();
}

function checkRateLimit(account, exchange = "binance") {
    const key = `${String(exchange || "binance").toLowerCase()}:${exactName(account)}`;
    const now = Date.now();
    let bucket = accountLastCall.get(key);

    if (!bucket || now - bucket.windowStart > RATE_LIMIT_WINDOW_MS) {
        bucket = { windowStart: now, count: 0 };
        accountLastCall.set(key, bucket);
    }

    if (bucket.count >= RATE_LIMIT_MAX) {
        const waitMs = RATE_LIMIT_WINDOW_MS - (now - bucket.windowStart);
        throw httpError(429, `Rate limit: chờ ${Math.ceil(waitMs / 1000)}s`);
    }

    bucket.count++;
}

async function getClient(account) {
    // Compat: trả adapter (có .client cho Binance callers/tests cũ).
    return getExchangeAdapter(account);
}

async function withAdapter(account, capability, run) {
    const adapter = await getExchangeAdapter(account);
    checkRateLimit(account, adapter.exchange);
    if (capability) adapter.requireCapability(capability);
    return run(adapter);
}

function targetInput(target, params = {}) {
    const account = target?.env || target?.username;
    return {
        account,
        symbol: target?.symbol || params.symbol,
        instrumentId: target?.instrumentId || target?.symbol || params.instrumentId || params.symbol,
        side: target?.positionSide || target?.side || params.positionSide || params.side,
        positionSide: target?.positionSide || params.positionSide,
        positionIdx: target?.positionIdx ?? params.positionIdx,
        ...params,
    };
}

async function cancelOrderDirect(target, params) {
    const account = target?.env || target?.username;
    const kind = String(params.kind || params.orderKind || "").toLowerCase();
    const capability = kind === "algo" || kind === "conditional" ? "conditionalOrder" : "regularOrder";
    return withAdapter(account, capability, (adapter) => adapter.cancelOrder({
        ...targetInput(target, params),
        orderKind: kind === "algo" ? "conditional" : (kind || "regular"),
        orderId: params.orderId,
        algoId: params.algoId || params.orderId,
        symbol: params.symbol || target?.symbol,
        instrumentId: params.instrumentId || params.symbol || target?.symbol,
    }));
}

async function cancelOrderBatchDirect(target, params) {
    const account = target?.env || target?.username;
    const { orders } = params;
    const results = [];

    for (const order of orders || []) {
        try {
            const one = await cancelOrderDirect(
                { username: account, env: account },
                { kind: order.kind, orderId: order.orderId, symbol: order.symbol, instrumentId: order.instrumentId }
            );
            results.push({ orderId: order.orderId, success: true, result: one.result, exchange: one.exchange });
        } catch (error) {
            console.error("[cancelOrderBatchDirect]", order.orderId, error.message);
            results.push({ orderId: order.orderId, success: false, error: error.message });
        }
    }
    return { success: true, results };
}

async function closePositionDirect(target, params) {
    const account = target?.env || target?.username;
    return withAdapter(account, "close", (adapter) => adapter.closePosition(targetInput(target, params)));
}

async function openPositionDirect(target, params) {
    const account = target?.env || target?.username;
    return withAdapter(account, "open", (adapter) => adapter.openPosition(targetInput(target, params)));
}

async function setTpslDirect(target, params) {
    const account = target?.env || target?.username;
    return withAdapter(account, null, (adapter) => adapter.setTpsl(targetInput(target, params)));
}

async function cancelTpslDirect(target, params) {
    const account = target?.env || target?.username;
    return withAdapter(account, "tpsl", (adapter) => adapter.cancelTpsl(targetInput(target, params)));
}

async function createOrderDirect(target, params) {
    const account = target?.env || target?.username;
    return withAdapter(account, null, (adapter) => adapter.createOrder(targetInput(target, {
        ...params,
        symbol: target?.symbol || params.symbol,
        instrumentId: target?.instrumentId || target?.symbol || params.instrumentId || params.symbol,
    })));
}

async function replaceOrderDirect(target, params) {
    const account = target?.env || target?.username;
    return withAdapter(account, null, (adapter) => adapter.replaceOrder(targetInput(target, params)));
}

async function reversePositionDirect(target, params) {
    const account = target?.env || target?.username;
    return withAdapter(account, "reverse", (adapter) => adapter.reversePosition(targetInput(target, params)));
}

const DIRECT_HANDLERS = {
    ORDER_CANCEL: cancelOrderDirect,
    ORDER_CANCEL_BATCH: cancelOrderBatchDirect,
    POSITION_CLOSE: closePositionDirect,
    POSITION_OPEN: openPositionDirect,
    POSITION_SET_TPSL: setTpslDirect,
    POSITION_CANCEL_TPSL: cancelTpslDirect,
    ORDER_CREATE: createOrderDirect,
    ORDER_REPLACE: replaceOrderDirect,
    POSITION_REVERSE: reversePositionDirect,
};

async function executeDirectTrading(action, target, params) {
    const handler = DIRECT_HANDLERS[action];
    if (!handler) {
        throw httpError(400, `Action không hỗ trợ: ${action}`);
    }
    return handler(target, params);
}

async function tryDirectExecution(action, target, params) {
    const handler = DIRECT_HANDLERS[action];
    if (!handler) return null;

    try {
        return await handler(target, params);
    } catch (error) {
        if (error.message?.includes("API key")) {
            console.warn(`[directTrading] ${action} no API key for ${target?.username}`);
            return null;
        }
        throw error;
    }
}

module.exports = {
    executeDirectTrading,
    tryDirectExecution,
    getClient,
    checkRateLimit,
    DIRECT_HANDLERS,
    cancelOrderDirect,
    cancelOrderBatchDirect,
    closePositionDirect,
    openPositionDirect,
    setTpslDirect,
    cancelTpslDirect,
    createOrderDirect,
    replaceOrderDirect,
    reversePositionDirect,
};
