/**
 * Gọi Binance API trực tiếp cho trading actions.
 * Đây là cách chính để thực hiện trading - không qua MQTT.
 */
const { httpError } = require("./http");
const UserApi = require("../models/user-api");
const { createBinanceFutures } = require("./binance-futures");
const { findSymbolInfo, floorToStep, roundToTick } = require("./symbol-info");

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

    const info = await findSymbolInfo(symbol);
    const qtyText = floorToStep(closeQty, info?.stepSize);
    if (!qtyText) throw httpError(400, "Số lượng đóng sau làm tròn = 0 (kiểm tra stepSize)");

    const isLong = parseFloat(position.positionAmt) > 0;
    const closeSide = isLong ? "SELL" : "BUY";
    const type = String(orderType || "MARKET").toUpperCase();

    const posSide = position.positionSide || "BOTH";
    const orderParams = {
        symbol,
        side: closeSide,
        positionSide: posSide,
        type,
        quantity: qtyText,
    };
    // One-way cần reduceOnly; hedge mode (LONG/SHORT) không gửi field này.
    if (posSide === "BOTH") orderParams.reduceOnly = "true";

    if (type === "LIMIT") {
        const priceText = roundToTick(price, info?.tickSize);
        if (!priceText) throw httpError(400, "LIMIT close cần giá hợp lệ");
        orderParams.price = priceText;
        orderParams.timeInForce = "GTC";
    }

    console.log("[closePositionDirect]", account, symbol, type, orderParams);
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

function resolveWorkingType(value) {
    const raw = String(value || "CONTRACT_PRICE").toUpperCase();
    if (raw === "MARK" || raw === "MARK_PRICE") return "MARK_PRICE";
    return "CONTRACT_PRICE"; // Last price
}

function tpslTriggerOf(params, kind) {
    if (kind === "tp") {
        if (params?.tp != null && params.tp !== "") return params.tp;
        return params?.takeProfit?.triggerPrice ?? params?.takeProfit?.price ?? null;
    }
    if (params?.sl != null && params.sl !== "") return params.sl;
    return params?.stopLoss?.triggerPrice ?? params?.stopLoss?.price ?? null;
}

async function cancelProtectiveOrders(client, symbol, positionSide, kinds) {
    const open = await client.signedGet("/fapi/v1/openOrders", { symbol }).catch((error) => {
        console.warn("[cancelProtectiveOrders]", error.message);
        return [];
    });
    const cancelled = [];
    for (const order of Array.isArray(open) ? open : []) {
        const type = String(order.type || "").toUpperCase();
        const side = String(order.positionSide || "BOTH").toUpperCase();
        const sideOk = !positionSide || positionSide === "BOTH" || side === "BOTH" || side === String(positionSide).toUpperCase();
        if (!sideOk) continue;
        if (!kinds.some((kind) => type.includes(kind))) continue;
        try {
            await client.signed("DELETE", "/fapi/v1/order", { symbol, orderId: order.orderId });
            cancelled.push({ orderId: order.orderId, type });
        } catch (error) {
            console.warn("[cancelProtectiveOrders]", order.orderId, error.message);
        }
    }
    return cancelled;
}

/**
 * Set TP/SL (Position TP/SL kiểu Binance: TAKE_PROFIT_MARKET / STOP_MARKET + closePosition).
 */
async function setTpslDirect(target, params) {
    const account = target?.env || target?.username;
    checkRateLimit(account);
    const client = await getClient(account);

    const { symbol, positionSide } = target;
    const tpRaw = tpslTriggerOf(params, "tp");
    const slRaw = tpslTriggerOf(params, "sl");
    const tpEnabled = params?.takeProfit?.enabled !== false && tpRaw != null && tpRaw !== "";
    const slEnabled = params?.stopLoss?.enabled !== false && slRaw != null && slRaw !== "";
    if (!tpEnabled && !slEnabled) throw httpError(400, "Cần ít nhất TP hoặc SL");

    const positions = await client.signedGet("/fapi/v2/positionRisk", { symbol });
    const position = (Array.isArray(positions) ? positions : []).find(
        (p) => p.symbol === symbol && (p.positionSide === positionSide || positionSide === "BOTH")
    );

    if (!position || Math.abs(parseFloat(position.positionAmt)) < 1e-8) {
        throw httpError(400, "Position không tồn tại");
    }

    const isLong = parseFloat(position.positionAmt) > 0;
    const closeSide = isLong ? "SELL" : "BUY";
    const posSide = position.positionSide || "BOTH";
    const info = await findSymbolInfo(symbol);
    const results = [];
    const cancelKinds = [];
    if (tpEnabled) cancelKinds.push("TAKE_PROFIT");
    if (slEnabled) cancelKinds.push("STOP");
    // Binance chỉ cho 1 closePosition cùng loại — hủy cái cũ trước khi đặt mới.
    const cancelled = await cancelProtectiveOrders(client, symbol, posSide, cancelKinds);

    if (tpEnabled) {
        try {
            const stopPrice = roundToTick(tpRaw, info?.tickSize);
            if (!stopPrice) throw httpError(400, "Giá TP không hợp lệ");
            const workingType = resolveWorkingType(params?.tpWorkingType || params?.takeProfit?.workingType || params?.workingType);
            const tpType = String(params?.tpType || params?.takeProfit?.type || "TAKE_PROFIT_MARKET").toUpperCase();
            const tpOrder = await client.signed("POST", "/fapi/v1/order", {
                symbol,
                side: closeSide,
                positionSide: posSide,
                type: tpType,
                stopPrice,
                closePosition: "true",
                workingType,
            });
            results.push({ type: "TP", success: true, orderId: tpOrder?.orderId, stopPrice, workingType });
        } catch (error) {
            results.push({ type: "TP", success: false, error: error.message });
        }
    }

    if (slEnabled) {
        try {
            const stopPrice = roundToTick(slRaw, info?.tickSize);
            if (!stopPrice) throw httpError(400, "Giá SL không hợp lệ");
            const workingType = resolveWorkingType(params?.slWorkingType || params?.stopLoss?.workingType || params?.workingType);
            const slType = String(params?.slType || params?.stopLoss?.type || "STOP_MARKET").toUpperCase();
            const slOrder = await client.signed("POST", "/fapi/v1/order", {
                symbol,
                side: closeSide,
                positionSide: posSide,
                type: slType,
                stopPrice,
                closePosition: "true",
                workingType,
            });
            results.push({ type: "SL", success: true, orderId: slOrder?.orderId, stopPrice, workingType });
        } catch (error) {
            results.push({ type: "SL", success: false, error: error.message });
        }
    }

    const failed = results.filter((row) => !row.success);
    if (failed.length && failed.length === results.length) {
        throw httpError(400, failed.map((row) => `${row.type}: ${row.error}`).join("; "));
    }
    console.log("[setTpslDirect]", account, symbol, { cancelled: cancelled.length, results });
    return { success: failed.length === 0, results, cancelled };
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
