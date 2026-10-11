/**
 * Gọi Binance API trực tiếp cho trading actions.
 * Đây là cách chính để thực hiện trading - không qua MQTT.
 */
const { httpError } = require("./http");
const UserApi = require("../models/user-api");
const { createBinanceFutures } = require("./binance-futures");

// Rate limit: tối đa 10 requests / 10s / account
const accountLastCall = new Map();
const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_MAX = 10;

function exactName(account) {
    return String(account || "").trim().toUpperCase();
}

function checkRateLimit(account) {
    const key = exactName(account);
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
    const api = await UserApi.findOne({ username: exactName(account) }).select("username exchange api_key api_secret").lean();
    if (!api?.api_key || !api?.api_secret) {
        throw httpError(400, `Account ${account} chưa có API key`);
    }
    if (String(api.exchange || "binance").toLowerCase() !== "binance") {
        throw httpError(400, "Chỉ hỗ trợ Binance futures");
    }
    return createBinanceFutures({ apiKey: api.api_key, apiSecret: api.api_secret });
}

/**
 * Cancel order.
 */
async function cancelOrderDirect(target, params) {
    const account = target?.env || target?.username;
    checkRateLimit(account);
    const client = await getClient(account);

    const { kind, orderId, symbol } = params;

    if (kind === "algo") {
        // Cancel algo order
        const result = await client.signed("DELETE", "/fapi/v1/order", {
            symbol,
            orderId,
        });
        return { success: true, orderId, result };
    } else {
        const result = await client.signed("DELETE", "/fapi/v1/order", {
            symbol,
            orderId,
        });
        return { success: true, orderId, result };
    }
}

/**
 * Cancel batch orders.
 */
async function cancelOrderBatchDirect(target, params) {
    const account = target?.env || target?.username;
    checkRateLimit(account);
    const client = await getClient(account);

    const { orders } = params;
    const results = [];

    for (const order of orders) {
        try {
            const result = await client.signed("DELETE", "/fapi/v1/order", {
                symbol: order.symbol,
                orderId: order.orderId,
            });
            results.push({ orderId: order.orderId, success: true, result });
        } catch (error) {
            results.push({ orderId: order.orderId, success: false, error: error.message });
        }
    }
    return { success: true, results };
}

/**
 * Close position.
 */
async function closePositionDirect(target, params) {
    const account = target?.env || target?.username;
    checkRateLimit(account);
    const client = await getClient(account);

    const { symbol, positionSide } = target;
    const { orderType, quantityMode, quantity, percent, price } = params;

    // Lấy position hiện tại
    const positions = await client.signedGet("/fapi/v2/positionRisk", { symbol });
    const position = (Array.isArray(positions) ? positions : []).find(
        (p) => p.symbol === symbol && (p.positionSide === positionSide || positionSide === "BOTH")
    );

    if (!position || Math.abs(parseFloat(position.positionAmt)) < 1e-8) {
        return { success: true, message: "Position đã đóng hoặc không tồn tại" };
    }

    const positionAmt = Math.abs(parseFloat(position.positionAmt));
    let closeQty;

    if (quantityMode === "ALL") {
        closeQty = positionAmt;
    } else if (quantityMode === "PERCENT") {
        closeQty = positionAmt * (parseFloat(percent) / 100);
    } else if (quantityMode === "QUANTITY") {
        closeQty = Math.min(parseFloat(quantity), positionAmt);
    } else {
        closeQty = positionAmt;
    }

    const isLong = parseFloat(position.positionAmt) > 0;
    const closeSide = isLong ? "SELL" : "BUY";

    const orderParams = {
        symbol,
        side: closeSide,
        positionSide: position.positionSide || "BOTH",
        type: orderType || "MARKET",
        quantity: String(closeQty),
    };

    if (orderType === "LIMIT" && price) {
        orderParams.price = String(price);
        orderParams.timeInForce = "GTC";
    }

    const result = await client.signed("POST", "/fapi/v1/order", orderParams);
    return { success: true, orderId: result?.orderId, result };
}

/**
 * Open position.
 */
async function openPositionDirect(target, params) {
    const account = target?.env || target?.username;
    checkRateLimit(account);
    const client = await getClient(account);

    const { symbol, positionSide } = target;
    const { orderType, quantity, price } = params;

    const side = positionSide === "SHORT" ? "SELL" : "BUY";

    const orderParams = {
        symbol,
        side,
        positionSide: positionSide || "BOTH",
        type: orderType || "MARKET",
        quantity: String(quantity),
    };

    if (orderType === "LIMIT" && price) {
        orderParams.price = String(price);
        orderParams.timeInForce = "GTC";
    }

    const result = await client.signed("POST", "/fapi/v1/order", orderParams);
    return { success: true, orderId: result?.orderId, result };
}

/**
 * Set TP/SL.
 */
async function setTpslDirect(target, params) {
    const account = target?.env || target?.username;
    checkRateLimit(account);
    const client = await getClient(account);

    const { symbol, positionSide } = target;
    const { tp, sl, tpType, slType } = params;

    // Lấy position để biết side và qty
    const positions = await client.signedGet("/fapi/v2/positionRisk", { symbol });
    const position = (Array.isArray(positions) ? positions : []).find(
        (p) => p.symbol === symbol && (p.positionSide === positionSide || positionSide === "BOTH")
    );

    if (!position || Math.abs(parseFloat(position.positionAmt)) < 1e-8) {
        throw httpError(400, "Position không tồn tại");
    }

    const positionAmt = Math.abs(parseFloat(position.positionAmt));
    const isLong = parseFloat(position.positionAmt) > 0;
    const closeSide = isLong ? "SELL" : "BUY";

    const results = [];

    // Đặt TP
    if (tp) {
        try {
            const tpOrder = await client.signed("POST", "/fapi/v1/order", {
                symbol,
                side: closeSide,
                positionSide: position.positionSide || "BOTH",
                type: tpType || "TAKE_PROFIT_MARKET",
                stopPrice: String(tp),
                closePosition: "true",
            });
            results.push({ type: "TP", success: true, orderId: tpOrder?.orderId });
        } catch (error) {
            results.push({ type: "TP", success: false, error: error.message });
        }
    }

    // Đặt SL
    if (sl) {
        try {
            const slOrder = await client.signed("POST", "/fapi/v1/order", {
                symbol,
                side: closeSide,
                positionSide: position.positionSide || "BOTH",
                type: slType || "STOP_MARKET",
                stopPrice: String(sl),
                closePosition: "true",
            });
            results.push({ type: "SL", success: true, orderId: slOrder?.orderId });
        } catch (error) {
            results.push({ type: "SL", success: false, error: error.message });
        }
    }

    return { success: true, results };
}

/**
 * Cancel TP/SL.
 */
async function cancelTpslDirect(target, params) {
    const account = target?.env || target?.username;
    checkRateLimit(account);
    const client = await getClient(account);

    const { symbol } = target;
    const { orderId } = params;

    const result = await client.signed("DELETE", "/fapi/v1/order", {
        symbol,
        orderId,
    });
    return { success: true, orderId, result };
}

/**
 * Create order.
 */
async function createOrderDirect(target, params) {
    const account = target?.env || target?.username;
    checkRateLimit(account);
    const client = await getClient(account);

    const { symbol } = target;
    const { side, positionSide, type, quantity, price, triggerPrice } = params;

    const orderParams = {
        symbol,
        side,
        positionSide: positionSide || "BOTH",
        type,
        quantity: String(quantity),
    };

    if (type === "LIMIT") {
        orderParams.price = String(price);
        orderParams.timeInForce = "GTC";
    } else if (type === "STOP_MARKET" || type === "TAKE_PROFIT_MARKET") {
        orderParams.stopPrice = String(triggerPrice || price);
    } else if (type === "STOP" || type === "TAKE_PROFIT") {
        orderParams.price = String(price);
        orderParams.stopPrice = String(triggerPrice);
    }

    const result = await client.signed("POST", "/fapi/v1/order", orderParams);
    return { success: true, orderId: result?.orderId, result };
}

/**
 * Reverse position (close + open opposite).
 */
async function reversePositionDirect(target, params) {
    const account = target?.env || target?.username;
    checkRateLimit(account);

    const { symbol, positionSide } = target;
    const { closeOrderType, openOrderType, newQuantity } = params;

    // Close current
    const closeResult = await closePositionDirect(target, {
        orderType: closeOrderType || "MARKET",
        quantityMode: "ALL",
    });

    if (!closeResult?.success) {
        return { success: false, error: "Close failed", closeResult };
    }

    // Open opposite
    const newSide = positionSide === "LONG" ? "SHORT" : "LONG";
    const openResult = await openPositionDirect(
        { ...target, positionSide: newSide },
        { orderType: openOrderType || "MARKET", quantity: newQuantity }
    );

    return { success: true, closeResult, openResult };
}

/**
 * Map action → direct handler.
 */
const DIRECT_HANDLERS = {
    ORDER_CANCEL: cancelOrderDirect,
    ORDER_CANCEL_BATCH: cancelOrderBatchDirect,
    POSITION_CLOSE: closePositionDirect,
    POSITION_OPEN: openPositionDirect,
    POSITION_SET_TPSL: setTpslDirect,
    POSITION_CANCEL_TPSL: cancelTpslDirect,
    ORDER_CREATE: createOrderDirect,
    POSITION_REVERSE: reversePositionDirect,
};

/**
 * Thực hiện action trực tiếp qua Binance API.
 * Đây là cách chính - không fallback MQTT.
 */
async function executeDirectTrading(action, target, params) {
    const handler = DIRECT_HANDLERS[action];
    if (!handler) {
        throw httpError(400, `Action không hỗ trợ: ${action}`);
    }
    return handler(target, params);
}

/**
 * Thử thực hiện action - trả về null nếu không có API key.
 * Dùng cho fallback logic.
 */
async function tryDirectExecution(action, target, params) {
    const handler = DIRECT_HANDLERS[action];
    if (!handler) return null;

    try {
        const result = await handler(target, params);
        return result;
    } catch (error) {
        // Nếu lỗi là không có API key, trả null để fallback
        if (error.message?.includes("API key")) {
            console.warn(`[directTrading] ${action} no API key for ${target?.username}`);
            return null;
        }
        // Lỗi khác thì throw
        throw error;
    }
}

module.exports = {
    executeDirectTrading,
    tryDirectExecution,
    getClient,
    checkRateLimit,
    DIRECT_HANDLERS,
    // Export individual handlers for testing
    cancelOrderDirect,
    cancelOrderBatchDirect,
    closePositionDirect,
    openPositionDirect,
    setTpslDirect,
    cancelTpslDirect,
    createOrderDirect,
    reversePositionDirect,
};
