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
        if (params.quantityIncrease === false) return false;
    }
    // Reverse: gate open-leg only (close phải chạy). Caller truyền phase=open_leg.
    if (action === "POSITION_REVERSE" && params.phase === "close_leg") {
        return false;
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

async function loadBookForGate(actor, username) {
    let positions = [];
    let wallet = null;
    let openOrders = [];
    try {
        const { loadPositions } = require("./positions");
        const fast = await loadPositions(actor, {
            account: username,
            audience: "mine",
            book: "",
        }, { mode: "fast" });
        positions = (fast?.rows || []).filter((r) => r.account === username);
    } catch {
        positions = [];
    }
    try {
        const { getAccountBalance } = require("./account-balance-read");
        wallet = await getAccountBalance(actor, { account: username });
    } catch {
        wallet = null;
    }
    try {
        const { loadOpenOrders } = require("./orders");
        if (typeof loadOpenOrders === "function") {
            const listed = await loadOpenOrders(actor, { account: username });
            openOrders = listed?.orders || listed?.rows || listed || [];
            if (!Array.isArray(openOrders)) openOrders = [];
        }
    } catch {
        openOrders = [];
    }
    return { positions, wallet, openOrders };
}

/**
 * Gate trước side-effect tăng exposure trên web trading-bridge.
 */
async function gateTradingIncrease({
    actor,
    action,
    target,
    params,
    positions,
    wallet,
    openOrders,
    loadBook = true,
} = {}) {
    if (!isIncreaseAction(action, params)) {
        return { required: false, allowed: true };
    }

    const username = target?.username;
    let book = { positions: positions || [], wallet: wallet || null, openOrders: openOrders || [] };
    if (loadBook && username && (!positions?.length && wallet == null)) {
        book = await loadBookForGate(actor, username);
    }

    const symbol = target?.symbol || params?.symbol;
    const quantity = params?.quantity ?? params?.newQuantity ?? params?.openQuantity;
    const notionalNeed = estimateNotional({
        symbol,
        quantity,
        price: params?.price || params?.triggerPrice || params?.markPrice,
    });

    const result = await reserveBudget({
        account: username,
        env: target.env,
        producer: "web-trading-bridge",
        producerVersion: "p2-fix",
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
            username,
            symbol,
            quantity,
            price: params?.price,
            positionSide: target.positionSide || params?.positionSide,
            actorId: actor?.id || null,
            phase: params?.phase || null,
        },
        book: params?.book === "paper" ? "paper" : "live",
        positions: book.positions,
        wallet: book.wallet,
        openOrders: book.openOrders,
        storeAvailable: true,
    });

    return { required: true, ...result, bookLoaded: true };
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
    loadBookForGate,
    INCREASE_ACTIONS,
};
