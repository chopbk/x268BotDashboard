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
 * Cancel một order (regular hoặc algo). Sai kind vẫn thử endpoint còn lại.
 */
async function cancelOrderDirect(target, params) {
    const account = target?.env || target?.username;
    checkRateLimit(account);
    const client = await getClient(account);

    const { kind, orderId, symbol } = params;
    const id = String(orderId || "").trim();
    if (!id) throw httpError(400, "Thiếu orderId");
    if (!symbol) throw httpError(400, "Thiếu symbol");

    // Algo cancel chỉ nhận algoId; gửi nhầm orderId thường → "Unknown order sent".
    const cancelAlgo = () => client.signed("DELETE", "/fapi/v1/algoOrder", { symbol, algoId: id });
    const cancelRegular = () => client.signed("DELETE", "/fapi/v1/order", { symbol, orderId: id });

    if (String(kind || "").toLowerCase() === "algo") {
        try {
            const result = await cancelAlgo();
            return { success: true, orderId: id, algoId: id, result };
        } catch (error) {
            console.warn("[cancelOrderDirect] algo failed, try regular:", error.message);
            try {
                const result = await cancelRegular();
                return { success: true, orderId: id, result };
            } catch (fallbackError) {
                const msg = error.message || fallbackError.message || "Unknown order sent";
                throw httpError(400, `Huỷ algo #${id} thất bại: ${msg}`);
            }
        }
    }

    try {
        const result = await cancelRegular();
        return { success: true, orderId: id, result };
    } catch (error) {
        console.warn("[cancelOrderDirect] regular failed, try algo:", error.message);
        try {
            const result = await cancelAlgo();
            return { success: true, orderId: id, algoId: id, result };
        } catch (fallbackError) {
            const msg = error.message || fallbackError.message || "Unknown order sent";
            throw httpError(400, `Huỷ order #${id} thất bại: ${msg}`);
        }
    }
}

/**
 * Cancel batch orders.
 */
async function cancelOrderBatchDirect(target, params) {
    const account = target?.env || target?.username;
    const { orders } = params;
    const results = [];

    for (const order of orders || []) {
        try {
            const one = await cancelOrderDirect(
                { username: account, env: account },
                { kind: order.kind, orderId: order.orderId, symbol: order.symbol }
            );
            results.push({ orderId: order.orderId, success: true, result: one.result });
        } catch (error) {
            console.error("[cancelOrderBatchDirect]", order.orderId, error.message);
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
    const type = String(orderType || "MARKET").toUpperCase();
    const info = await findSymbolInfo(symbol);
    const qtyText = floorToStep(quantity, info?.stepSize);
    if (!qtyText) throw httpError(400, "Quantity sau làm tròn = 0");

    const side = positionSide === "SHORT" ? "SELL" : "BUY";

    const orderParams = {
        symbol,
        side,
        positionSide: positionSide || "BOTH",
        type,
        quantity: qtyText,
    };

    if (type === "LIMIT") {
        const priceText = roundToTick(price, info?.tickSize);
        if (!priceText) throw httpError(400, "LIMIT open cần giá hợp lệ");
        orderParams.price = priceText;
        orderParams.timeInForce = "GTC";
    }

    console.log("[openPositionDirect]", account, symbol, orderParams);
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

const ALGO_ORDER_TYPES = new Set([
    "STOP",
    "STOP_MARKET",
    "TAKE_PROFIT",
    "TAKE_PROFIT_MARKET",
    "TRAILING_STOP_MARKET",
]);

function orderTypeOf(order) {
    return String(order?.type || order?.orderType || "").toUpperCase();
}

function matchesProtectiveKind(type, kinds) {
    const t = String(type || "").toUpperCase();
    return (kinds || []).some((kind) => {
        if (kind === "TAKE_PROFIT") return t.includes("TAKE_PROFIT");
        if (kind === "STOP") return t === "STOP" || t === "STOP_MARKET";
        if (kind === "TRAILING") return t.includes("TRAILING");
        return t.includes(kind);
    });
}

function positionSideOk(orderSide, positionSide) {
    const side = String(orderSide || "BOTH").toUpperCase();
    const want = String(positionSide || "BOTH").toUpperCase();
    return !want || want === "BOTH" || side === "BOTH" || side === want;
}

/**
 * Hủy TP/SL cũ: ưu tiên Algo Order API, vẫn thử openOrders legacy.
 */
async function cancelProtectiveOrders(client, symbol, positionSide, kinds) {
    const cancelled = [];
    const [algoRaw, openRaw] = await Promise.all([
        client.signedGet("/fapi/v1/openAlgoOrders", { symbol }).catch((error) => {
            console.warn("[cancelProtectiveOrders] openAlgoOrders", error.message);
            return [];
        }),
        client.signedGet("/fapi/v1/openOrders", { symbol }).catch((error) => {
            console.warn("[cancelProtectiveOrders] openOrders", error.message);
            return [];
        }),
    ]);
    const algoList = Array.isArray(algoRaw) ? algoRaw : (algoRaw?.orders || []);
    for (const order of algoList) {
        const type = orderTypeOf(order);
        if (!positionSideOk(order.positionSide, positionSide)) continue;
        if (!matchesProtectiveKind(type, kinds)) continue;
        const algoId = order.algoId || order.orderId;
        if (!algoId) continue;
        try {
            await client.signed("DELETE", "/fapi/v1/algoOrder", { symbol, algoId: String(algoId) });
            cancelled.push({ algoId, type, via: "algo" });
        } catch (error) {
            console.warn("[cancelProtectiveOrders] algo", algoId, error.message);
        }
    }
    for (const order of Array.isArray(openRaw) ? openRaw : []) {
        const type = orderTypeOf(order);
        if (!ALGO_ORDER_TYPES.has(type) && !order.closePosition) continue;
        if (!positionSideOk(order.positionSide, positionSide)) continue;
        if (!matchesProtectiveKind(type, kinds)) continue;
        try {
            await client.signed("DELETE", "/fapi/v1/order", { symbol, orderId: order.orderId });
            cancelled.push({ orderId: order.orderId, type, via: "order" });
        } catch (error) {
            console.warn("[cancelProtectiveOrders] order", order.orderId, error.message);
        }
    }
    return cancelled;
}

async function placeAlgoProtective(client, {
    symbol, side, positionSide, type, triggerPrice, workingType, limitPrice, callbackRate, activationPrice,
}) {
    const params = {
        algoType: "CONDITIONAL",
        symbol,
        side,
        positionSide,
        type,
        closePosition: "true",
        workingType: resolveWorkingType(workingType),
    };
    if (type === "TRAILING_STOP_MARKET") {
        params.callbackRate = String(callbackRate);
        if (activationPrice) params.activationPrice = String(activationPrice);
    } else {
        params.triggerPrice = String(triggerPrice);
        if ((type === "STOP" || type === "TAKE_PROFIT") && limitPrice) {
            params.price = String(limitPrice);
            params.timeInForce = "GTC";
        }
    }
    console.log("[placeAlgoProtective]", symbol, type, params);
    const result = await client.signed("POST", "/fapi/v1/algoOrder", params);
    return {
        algoId: result?.algoId || result?.orderId,
        orderId: result?.algoId || result?.orderId,
        result,
    };
}

/**
 * Set TP/SL/Trailing qua Algo Order API.
 */
async function setTpslDirect(target, params) {
    const account = target?.env || target?.username;
    checkRateLimit(account);
    const client = await getClient(account);

    const { symbol, positionSide } = target;
    const tpRaw = tpslTriggerOf(params, "tp");
    const slRaw = tpslTriggerOf(params, "sl");
    const trail = params?.trailing || {};
    const tpEnabled = params?.takeProfit?.enabled !== false && tpRaw != null && tpRaw !== "";
    const slEnabled = params?.stopLoss?.enabled !== false && slRaw != null && slRaw !== "";
    const trailCancelOnly = trail.enabled === false && trail.cancel === true;
    const trailEnabled = trail.enabled !== false && trail.callbackRate != null && trail.callbackRate !== "";
    if (!tpEnabled && !slEnabled && !trailEnabled && !trailCancelOnly) {
        throw httpError(400, "Cần ít nhất TP, SL hoặc Trailing");
    }

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
    if (trailEnabled || trailCancelOnly) cancelKinds.push("TRAILING");
    const cancelled = await cancelProtectiveOrders(client, symbol, posSide, cancelKinds);

    if (trailCancelOnly && !tpEnabled && !slEnabled && !trailEnabled) {
        console.log("[setTpslDirect]", account, symbol, "cancel trailing only", cancelled.length);
        return { success: true, results: [{ type: "TRAILING", success: true, cancelled: true }], cancelled };
    }

    if (tpEnabled) {
        try {
            const triggerPrice = roundToTick(tpRaw, info?.tickSize);
            if (!triggerPrice) throw httpError(400, "Giá TP không hợp lệ");
            const workingType = resolveWorkingType(params?.tpWorkingType || params?.takeProfit?.workingType || params?.workingType);
            const tpType = String(params?.tpType || params?.takeProfit?.type || "TAKE_PROFIT_MARKET").toUpperCase();
            const placed = await placeAlgoProtective(client, {
                symbol,
                side: closeSide,
                positionSide: posSide,
                type: tpType,
                triggerPrice,
                workingType,
                limitPrice: params?.takeProfit?.limitPrice,
            });
            results.push({ type: "TP", success: true, orderId: placed.orderId, algoId: placed.algoId, stopPrice: triggerPrice, workingType });
        } catch (error) {
            results.push({ type: "TP", success: false, error: error.message });
        }
    }

    if (slEnabled) {
        try {
            const triggerPrice = roundToTick(slRaw, info?.tickSize);
            if (!triggerPrice) throw httpError(400, "Giá SL không hợp lệ");
            const workingType = resolveWorkingType(params?.slWorkingType || params?.stopLoss?.workingType || params?.workingType);
            const slType = String(params?.slType || params?.stopLoss?.type || "STOP_MARKET").toUpperCase();
            const placed = await placeAlgoProtective(client, {
                symbol,
                side: closeSide,
                positionSide: posSide,
                type: slType,
                triggerPrice,
                workingType,
                limitPrice: params?.stopLoss?.limitPrice,
            });
            results.push({ type: "SL", success: true, orderId: placed.orderId, algoId: placed.algoId, stopPrice: triggerPrice, workingType });
        } catch (error) {
            results.push({ type: "SL", success: false, error: error.message });
        }
    }

    if (trailEnabled) {
        try {
            const callbackRate = Number(trail.callbackRate);
            if (!(callbackRate >= 0.1 && callbackRate <= 10)) {
                throw httpError(400, "callbackRate trailing phải trong 0.1–10 (%)");
            }
            const activation = trail.activationPrice
                ? roundToTick(trail.activationPrice, info?.tickSize)
                : null;
            const workingType = resolveWorkingType(trail.workingType || params?.workingType);
            const placed = await placeAlgoProtective(client, {
                symbol,
                side: closeSide,
                positionSide: posSide,
                type: "TRAILING_STOP_MARKET",
                callbackRate,
                activationPrice: activation || undefined,
                workingType,
            });
            results.push({
                type: "TRAILING",
                success: true,
                orderId: placed.orderId,
                algoId: placed.algoId,
                callbackRate,
                activationPrice: activation,
                workingType,
            });
        } catch (error) {
            results.push({ type: "TRAILING", success: false, error: error.message });
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
 * Cancel TP/SL (algoId ưu tiên; fallback orderId thường).
 */
async function cancelTpslDirect(target, params) {
    const account = target?.env || target?.username;
    checkRateLimit(account);
    const client = await getClient(account);

    const { symbol } = target;
    const { orderId, kind } = params;
    const id = String(orderId || "").trim();
    if (!id) throw httpError(400, "Thiếu orderId/algoId");

    const preferAlgo = String(kind || "").toLowerCase() === "algo"
        || String(kind || "").toLowerCase() === "tp"
        || String(kind || "").toLowerCase() === "sl";

    if (preferAlgo) {
        try {
            const result = await client.signed("DELETE", "/fapi/v1/algoOrder", { symbol, algoId: id });
            return { success: true, orderId: id, algoId: id, result };
        } catch (error) {
            console.warn("[cancelTpslDirect] algo failed, try regular:", error.message);
        }
    }

    try {
        const result = await client.signed("DELETE", "/fapi/v1/order", { symbol, orderId: id });
        return { success: true, orderId: id, result };
    } catch (error) {
        const result = await client.signed("DELETE", "/fapi/v1/algoOrder", { symbol, algoId: id });
        return { success: true, orderId: id, algoId: id, result };
    }
}

/**
 * Create order — conditional types đi Algo Order API.
 */
async function createOrderDirect(target, params) {
    const account = target?.env || target?.username;
    checkRateLimit(account);
    const client = await getClient(account);

    const { symbol } = target;
    const {
        side,
        positionSide,
        type,
        quantity,
        price,
        triggerPrice,
        closePosition,
        workingType,
        reduceOnly,
        callbackRate,
        timeInForce,
    } = params;
    const orderType = String(type || "LIMIT").toUpperCase();
    const info = await findSymbolInfo(symbol);
    const closeAll = closePosition === true || closePosition === "true";

    if (ALGO_ORDER_TYPES.has(orderType)) {
        const orderParams = {
            algoType: "CONDITIONAL",
            symbol,
            side: String(side || "").toUpperCase(),
            positionSide: String(positionSide || "BOTH").toUpperCase(),
            type: orderType,
            workingType: resolveWorkingType(workingType),
        };
        if (orderType === "TRAILING_STOP_MARKET") {
            const rate = Number(callbackRate);
            if (!(rate >= 0.1 && rate <= 10)) throw httpError(400, "callbackRate trailing phải 0.1–10");
            orderParams.callbackRate = String(rate);
            if (triggerPrice != null && triggerPrice !== "") {
                const act = roundToTick(triggerPrice, info?.tickSize);
                if (act) orderParams.activatePrice = act;
            }
        } else {
            const triggerText = roundToTick(triggerPrice || price, info?.tickSize);
            if (!triggerText) throw httpError(400, "Thiếu triggerPrice cho algo order");
            orderParams.triggerPrice = triggerText;
        }
        if (closeAll) {
            orderParams.closePosition = "true";
        } else {
            const qtyText = floorToStep(quantity, info?.stepSize);
            if (!qtyText) throw httpError(400, "Quantity sau làm tròn = 0");
            orderParams.quantity = qtyText;
        }
        if (orderType === "STOP" || orderType === "TAKE_PROFIT") {
            const priceText = roundToTick(price, info?.tickSize);
            if (!priceText) throw httpError(400, "STOP/TAKE_PROFIT cần giá limit");
            orderParams.price = priceText;
            orderParams.timeInForce = String(timeInForce || "GTC").toUpperCase();
        }
        console.log("[createOrderDirect]", account, "algo", orderParams);
        const result = await client.signed("POST", "/fapi/v1/algoOrder", orderParams);
        return { success: true, orderId: result?.algoId || result?.orderId, algoId: result?.algoId, result };
    }

    const qtyText = floorToStep(quantity, info?.stepSize);
    if (!qtyText) throw httpError(400, "Quantity sau làm tròn = 0");
    const orderParams = {
        symbol,
        side: String(side || "").toUpperCase(),
        positionSide: String(positionSide || "BOTH").toUpperCase(),
        type: orderType,
        quantity: qtyText,
    };
    if (reduceOnly === true || reduceOnly === "true") orderParams.reduceOnly = "true";
    if (orderType === "LIMIT") {
        const priceText = roundToTick(price, info?.tickSize);
        if (!priceText) throw httpError(400, "LIMIT cần giá hợp lệ");
        orderParams.price = priceText;
        orderParams.timeInForce = String(timeInForce || "GTC").toUpperCase();
    }

    console.log("[createOrderDirect]", account, orderParams);
    const result = await client.signed("POST", "/fapi/v1/order", orderParams);
    return { success: true, orderId: result?.orderId, result };
}

/**
 * Sửa order = huỷ cũ + đặt mới (Binance không amend đầy đủ mọi loại).
 */
async function replaceOrderDirect(target, params) {
    const symbol = String(target?.symbol || params.symbol || "").toUpperCase();
    if (!symbol) throw httpError(400, "Thiếu symbol");
    const kind = String(params.kind || "regular").toLowerCase();
    const orderId = String(params.orderId || "").trim();
    if (!orderId) throw httpError(400, "Thiếu orderId");

    const cancelled = await cancelOrderDirect(target, { kind, orderId, symbol });
    const created = await createOrderDirect(
        { ...target, symbol },
        {
            side: params.side,
            positionSide: params.positionSide,
            type: params.type,
            quantity: params.quantity,
            price: params.price,
            triggerPrice: params.triggerPrice,
            callbackRate: params.callbackRate,
            reduceOnly: params.reduceOnly,
            closePosition: params.closePosition,
            workingType: params.workingType,
            timeInForce: params.timeInForce,
        }
    );
    return { success: true, cancelled, created, orderId: created?.orderId || created?.algoId };
}

/**
 * Reverse position (close + open opposite).
 */
async function reversePositionDirect(target, params) {
    const account = target?.env || target?.username;
    checkRateLimit(account);

    const { symbol, positionSide } = target;
    const { closeOrderType, openOrderType, newQuantity } = params;

    const client = await getClient(account);
    const positions = await client.signedGet("/fapi/v2/positionRisk", { symbol });
    const position = (Array.isArray(positions) ? positions : []).find(
        (p) => p.symbol === symbol && (p.positionSide === positionSide || positionSide === "BOTH")
    );
    const currentQty = Math.abs(parseFloat(position?.positionAmt || 0));
    if (!(currentQty > 0)) throw httpError(400, "Position không tồn tại để reverse");
    const openQty = newQuantity != null && newQuantity !== "" ? newQuantity : currentQty;

    const closeResult = await closePositionDirect(target, {
        orderType: closeOrderType || "MARKET",
        quantityMode: "ALL",
    });

    if (!closeResult?.success) {
        return { success: false, error: "Close failed", closeResult };
    }

    const newSide = positionSide === "LONG" ? "SHORT" : "LONG";
    const openResult = await openPositionDirect(
        { ...target, positionSide: newSide },
        { orderType: openOrderType || "MARKET", quantity: openQty }
    );

    return { success: true, closeResult, openResult, openQty, newSide };
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
    ORDER_REPLACE: replaceOrderDirect,
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
    replaceOrderDirect,
    reversePositionDirect,
};
