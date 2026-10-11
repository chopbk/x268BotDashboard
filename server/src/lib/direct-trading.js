/**
 * Gọi Binance API trực tiếp cho trading actions.
 * Dùng khi web-bot có API key trong user_apis collection.
 */
const { httpError } = require("./http");
const UserApi = require("../models/user-api");
const { createBinanceFutures } = require("./binance-rest");

function exactName(account) {
    return String(account || "").trim().toUpperCase();
}

async function getClient(account) {
    const api = await UserApi.findOne({ username: exactName(account) }).select("username exchange api_key api_secret").lean();
    if (!api?.api_key || !api?.api_secret) return null; // Không có API key
    if (String(api.exchange || "binance").toLowerCase() !== "binance") return null;
    return createBinanceFutures({ apiKey: api.api_key, apiSecret: api.api_secret });
}

/**
 * Cancel order trực tiếp.
 */
async function cancelOrderDirect(target, params) {
    const account = target?.env || target?.username;
    const client = await getClient(account);
    if (!client) return null; // Không có client, skip

    const { kind, orderId, symbol } = params;

    if (kind === "algo") {
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
 * Close position trực tiếp.
 */
async function closePositionDirect(target, params) {
    const account = target?.env || target?.username;
    const client = await getClient(account);
    if (!client) return null;

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
 * Map action → direct handler.
 */
const DIRECT_HANDLERS = {
    ORDER_CANCEL: cancelOrderDirect,
    POSITION_CLOSE: closePositionDirect,
    // Các actions khác có thể thêm sau
};

/**
 * Thử thực hiện action trực tiếp qua Binance API.
 * @returns {object|null} Kết quả nếu thành công, null nếu không có client hoặc fail
 */
async function tryDirectExecution(action, target, params) {
    const handler = DIRECT_HANDLERS[action];
    if (!handler) return null; // Action không hỗ trợ direct

    try {
        const result = await handler(target, params);
        return result; // null nếu không có client, object nếu thành công
    } catch (error) {
        console.warn(`[directTrading] ${action} failed:`, error.message);
        return null; // Fail, sẽ fallback MQTT
    }
}

module.exports = {
    tryDirectExecution,
    getClient,
    cancelOrderDirect,
    closePositionDirect,
    DIRECT_HANDLERS,
};
