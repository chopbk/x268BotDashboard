const { reserveBudget, bindReservation } = require("./risk-reservation");
const { markQuoteOf } = require("./mark-prices");

const INCREASE_ACTIONS = new Set([
    "POSITION_OPEN",
    "ORDER_CREATE",
    "ORDER_REPLACE",
    "POSITION_REVERSE",
]);

function isIncreaseAction(action, params = {}) {
    if (!INCREASE_ACTIONS.has(action)) return false;
    if (action === "ORDER_CREATE" && (params.reduceOnly === true || params.closePosition === true)) {
        return false;
    }
    if (action === "ORDER_REPLACE") {
        // Chỉ gate khi tăng size — thiếu baseline coi là tăng tiềm năng
        if (params.quantityIncrease === false) return false;
    }
    return true;
}

function estimateNotional({ symbol, quantity, price }) {
    const qty = Math.abs(Number(quantity) || 0);
    let px = Number(price);
    if (!(px > 0)) {
        px = Number(markQuoteOf(symbol)?.mark) || 0;
    }
    if (!(qty > 0) || !(px > 0)) return null;
    return qty * px;
}

/**
 * Gate trước side-effect tăng exposure trên web trading-bridge.
 * Close/reduce/tpsl không gọi hàm này.
 */
async function gateTradingIncrease({
    actor,
    action,
    target,
    params,
    positions = [],
    wallet = null,
    openOrders = [],
}) {
    if (!isIncreaseAction(action, params)) {
        return { required: false, allowed: true };
    }

    const symbol = target?.symbol || params?.symbol;
    const quantity = params?.quantity ?? params?.newQuantity;
    const notionalNeed = estimateNotional({
        symbol,
        quantity,
        price: params?.price || params?.triggerPrice,
    });

    const result = await reserveBudget({
        account: target.username,
        env: target.env,
        producer: "web-trading-bridge",
        producerVersion: "p2",
        action,
        symbol,
        side: params?.side,
        positionSide: target.positionSide || params?.positionSide,
        notionalNeed: notionalNeed || 0,
        riskNeed: null,
        quantity,
        requestId: null,
        idempotencyKey: params?.riskIdempotencyKey,
        payload: {
            action,
            username: target.username,
            symbol,
            quantity,
            price: params?.price,
            positionSide: target.positionSide || params?.positionSide,
            actorId: actor?.id || null,
        },
        book: params?.book === "paper" ? "paper" : "live",
        positions,
        wallet,
        openOrders,
        storeAvailable: true,
    });

    return { required: true, ...result };
}

async function bindAfterSubmit(reservationId, meta) {
    if (!reservationId) return null;
    try {
        return await bindReservation(reservationId, meta);
    } catch {
        return null;
    }
}

module.exports = {
    gateTradingIncrease,
    bindAfterSubmit,
    isIncreaseAction,
    estimateNotional,
    INCREASE_ACTIONS,
};
