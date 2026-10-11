/**
 * Order business logic cho Phase A - Read-only Orders.
 * Spec: trading-terminal-spec.md
 */
const { PERMISSIONS, canAccessResource } = require("../auth/access-control");
const { httpError } = require("./http");

const OPEN_STATUSES = ["NEW", "PARTIALLY_FILLED"];
const TERMINAL_STATUSES = ["FILLED", "CANCELED", "EXPIRED", "REJECTED"];

function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

/**
 * Normalize một regular order từ Binance snapshot.
 */
function normalizeRegularOrder(row, username) {
    return {
        username,
        kind: "regular",
        orderId: String(row.orderId || ""),
        clientOrderId: row.clientOrderId || null,
        symbol: String(row.symbol || "").toUpperCase(),
        positionSide: String(row.positionSide || "BOTH").toUpperCase(),
        side: String(row.side || "").toUpperCase(),
        type: row.type || row.orderType || "",
        status: row.status || "NEW",
        price: row.price || null,
        stopPrice: row.stopPrice || null,
        triggerPrice: row.stopPrice || row.triggerPrice || null,
        origQty: row.origQty || row.quantity || null,
        executedQty: row.executedQty || "0",
        avgPrice: row.avgPrice || null,
        reduceOnly: row.reduceOnly === true,
        closePosition: row.closePosition === true,
        timeInForce: row.timeInForce || null,
        workingType: row.workingType || null,
        time: row.time || row.updateTime || null,
        updateTime: row.updateTime || row.time || null,
        source: "exchange",
        confirmed: true,
    };
}

/**
 * Normalize một algo/conditional order từ Binance snapshot.
 */
function normalizeAlgoOrder(row, username) {
    return {
        username,
        kind: "algo",
        orderId: String(row.algoId || row.strategyId || ""),
        clientOrderId: row.clientAlgoId || null,
        symbol: String(row.symbol || "").toUpperCase(),
        positionSide: String(row.positionSide || "BOTH").toUpperCase(),
        side: String(row.side || "").toUpperCase(),
        type: row.type || row.orderType || row.strategyType || "",
        status: row.algoStatus || row.strategyStatus || row.status || "NEW",
        price: row.price || null,
        stopPrice: row.stopPrice || row.triggerPrice || null,
        triggerPrice: row.stopPrice || row.triggerPrice || null,
        origQty: row.origQty || row.quantity || row.totalQty || null,
        executedQty: row.executedQty || "0",
        avgPrice: row.avgPrice || null,
        reduceOnly: row.reduceOnly === true,
        closePosition: row.closePosition === true,
        timeInForce: row.timeInForce || null,
        workingType: row.workingType || null,
        activationPrice: row.activationPrice || null,
        callbackRate: row.callbackRate || null,
        time: row.bookTime || row.updateTime || row.time || null,
        updateTime: row.updateTime || row.bookTime || row.time || null,
        source: "exchange",
        confirmed: true,
    };
}

/**
 * Kiểm tra order có đang open không.
 */
function isOpenOrder(order) {
    const status = String(order.status || "").toUpperCase();
    return OPEN_STATUSES.includes(status) || status === "WORKING";
}

/**
 * Kiểm tra order đã terminal chưa.
 */
function isTerminalOrder(order) {
    const status = String(order.status || "").toUpperCase();
    return TERMINAL_STATUSES.includes(status);
}

function isMine(actor, bot) {
    const username = bot?.username;
    if (!username || !actor) return false;
    const ownerUserId = bot.ownerUserId ? String(bot.ownerUserId) : "";
    if (ownerUserId && ownerUserId === String(actor.id || "")) return true;
    if (!ownerUserId && [actor.username, actor.email].filter(Boolean).includes(String(username))) return true;
    return (actor.botUsernames || []).includes(username);
}

/**
 * Lấy danh sách bot user được phép xem orders.
 */
async function visibleBots(actor, UserAccount, audience = "mine") {
    const rows = await UserAccount.find().select("username accounts ownerUserId visibility active").lean();
    return (rows || []).filter((row) => {
        if (!row?.username || row.active === false) return false;
        if (!canAccessResource(actor, PERMISSIONS.ORDERS_VIEW, row)) return false;
        if (audience === "all") return true;
        return isMine(actor, row);
    });
}

/**
 * Lấy open orders từ Redis exchange book snapshot.
 */
async function loadOpenOrders(actor, query = {}, deps = {}) {
    const UserAccount = deps.UserAccount || require("../models/user-account");
    const { readExchangeBook, readExchangeBooks } = deps.live || require("./position-live");

    const audience = query.audience === "all" ? "all" : "mine";
    const bots = await visibleBots(actor, UserAccount, audience);
    const names = bots.map((row) => row.username);

    const account = String(query.account || "").trim();
    if (account && !names.includes(account)) {
        throw httpError(403, "Không có quyền với tài khoản này");
    }

    const selected = account ? [account] : names;
    if (!selected.length) {
        return { orders: [], accounts: bots.map((row) => ({ username: row.username })), total: 0 };
    }

    // Đọc snapshot từ Redis
    const books = account
        ? { [account]: await readExchangeBook(account) }
        : await readExchangeBooks(selected);

    const orders = [];
    const errors = [];

    for (const name of selected) {
        const book = books[name];
        if (!book) {
            if (account) errors.push({ account: name, error: "Chưa có snapshot" });
            continue;
        }

        // Regular orders
        const regularOrders = Array.isArray(book.openOrders) ? book.openOrders : [];
        for (const row of regularOrders) {
            orders.push(normalizeRegularOrder(row, name));
        }

        // Algo orders
        const algoOrders = Array.isArray(book.algoOrders) ? book.algoOrders : [];
        for (const row of algoOrders) {
            orders.push(normalizeAlgoOrder(row, name));
        }
    }

    // Filter
    const filtered = filterOrders(orders, query);

    // Sort
    const sorted = sortOrders(filtered, query.sort || "updateTime", query.dir || "desc");

    return {
        orders: sorted,
        accounts: bots.map((row) => ({ username: row.username })),
        total: sorted.length,
        errors: errors.length ? errors : undefined,
    };
}

/**
 * Lấy order history từ Mongo.
 */
async function loadOrderHistory(actor, query = {}, deps = {}) {
    const UserAccount = deps.UserAccount || require("../models/user-account");
    const ExchangeOrderEvent = deps.ExchangeOrderEvent || require("../models/exchange-order-event");

    const audience = query.audience === "all" ? "all" : "mine";
    const bots = await visibleBots(actor, UserAccount, audience);
    const names = bots.map((row) => row.username);

    const account = String(query.account || "").trim();
    if (account && !names.includes(account)) {
        throw httpError(403, "Không có quyền với tài khoản này");
    }

    const selected = account ? [account] : names;
    if (!selected.length) {
        return { orders: [], accounts: bots.map((row) => ({ username: row.username })), total: 0, page: 1, pages: 1 };
    }

    // Build query
    const filter = { username: { $in: selected } };

    // Symbol filter
    const symbol = String(query.symbol || "").trim().toUpperCase();
    if (symbol) filter.symbol = symbol;

    // Kind filter
    const kind = String(query.kind || "").trim().toLowerCase();
    if (kind === "regular" || kind === "algo") filter.kind = kind;

    // Status filter
    const status = String(query.status || "").trim().toUpperCase();
    if (status) filter.status = status;

    // Side filter
    const side = String(query.side || "").trim().toUpperCase();
    if (side === "BUY" || side === "SELL") filter.side = side;

    // Position side filter
    const positionSide = String(query.positionSide || "").trim().toUpperCase();
    if (positionSide === "LONG" || positionSide === "SHORT") filter.positionSide = positionSide;

    // Type filter
    const type = String(query.type || "").trim().toUpperCase();
    if (type) filter.type = type;

    // Date range filter
    const from = query.from ? new Date(query.from) : null;
    const to = query.to ? new Date(query.to) : null;
    if (from && !Number.isNaN(from.getTime())) {
        filter.exchangeUpdatedAt = filter.exchangeUpdatedAt || {};
        filter.exchangeUpdatedAt.$gte = from;
    }
    if (to && !Number.isNaN(to.getTime())) {
        filter.exchangeUpdatedAt = filter.exchangeUpdatedAt || {};
        filter.exchangeUpdatedAt.$lte = to;
    }

    // Default: last 3 days if no range specified
    if (!from && !to) {
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
        filter.exchangeUpdatedAt = { $gte: threeDaysAgo };
    }

    // Pagination
    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 50));
    const skip = (page - 1) * limit;

    // Sort
    const sortField = query.sort === "createdAt" ? "exchangeCreatedAt" : "exchangeUpdatedAt";
    const sortDir = query.dir === "asc" ? 1 : -1;

    const [docs, total] = await Promise.all([
        ExchangeOrderEvent.find(filter)
            .sort({ [sortField]: sortDir })
            .skip(skip)
            .limit(limit)
            .lean(),
        ExchangeOrderEvent.countDocuments(filter),
    ]);

    const orders = docs.map((doc) => ({
        username: doc.username,
        kind: doc.kind,
        orderId: doc.orderId,
        clientOrderId: doc.clientOrderId || null,
        symbol: doc.symbol,
        positionSide: doc.positionSide,
        side: doc.side,
        type: doc.type,
        status: doc.status,
        price: doc.price,
        triggerPrice: doc.triggerPrice,
        origQty: doc.origQty,
        executedQty: doc.executedQty,
        avgPrice: doc.avgPrice,
        reduceOnly: doc.reduceOnly,
        closePosition: doc.closePosition,
        timeInForce: doc.timeInForce,
        workingType: doc.workingType,
        time: doc.exchangeCreatedAt,
        updateTime: doc.exchangeUpdatedAt,
        source: doc.source,
        confirmed: true,
    }));

    return {
        orders,
        accounts: bots.map((row) => ({ username: row.username })),
        total,
        page,
        pages: Math.ceil(total / limit) || 1,
        limit,
    };
}

/**
 * Lấy chi tiết một order.
 */
async function getOrderDetail(actor, params = {}, deps = {}) {
    const UserAccount = deps.UserAccount || require("../models/user-account");
    const ExchangeOrderEvent = deps.ExchangeOrderEvent || require("../models/exchange-order-event");
    const ExchangeFill = deps.ExchangeFill || require("../models/exchange-fill");
    const { readExchangeBook } = deps.live || require("./position-live");

    const kind = String(params.kind || "").trim().toLowerCase();
    const symbol = String(params.symbol || "").trim().toUpperCase();
    const orderId = String(params.orderId || "").trim();
    const account = String(params.account || "").trim();

    if (!kind || !symbol || !orderId || !account) {
        throw httpError(400, "Cần kind, symbol, orderId và account");
    }

    // Kiểm tra quyền
    const bot = await UserAccount.findOne({ username: account }).select("username ownerUserId visibility active").lean();
    if (!bot || bot.active === false) {
        throw httpError(404, "Không tìm thấy tài khoản");
    }
    if (!canAccessResource(actor, PERMISSIONS.ORDERS_VIEW, bot)) {
        throw httpError(403, "Không có quyền với tài khoản này");
    }

    // Tìm trong Mongo history
    const doc = await ExchangeOrderEvent.findOne({
        username: account,
        kind,
        symbol,
        orderId,
    }).lean();

    // Tìm trong Redis snapshot nếu chưa có trong history
    let order = null;
    if (doc) {
        order = {
            username: doc.username,
            kind: doc.kind,
            orderId: doc.orderId,
            clientOrderId: doc.clientOrderId || null,
            symbol: doc.symbol,
            positionSide: doc.positionSide,
            side: doc.side,
            type: doc.type,
            status: doc.status,
            price: doc.price,
            triggerPrice: doc.triggerPrice,
            origQty: doc.origQty,
            executedQty: doc.executedQty,
            avgPrice: doc.avgPrice,
            reduceOnly: doc.reduceOnly,
            closePosition: doc.closePosition,
            timeInForce: doc.timeInForce,
            workingType: doc.workingType,
            time: doc.exchangeCreatedAt,
            updateTime: doc.exchangeUpdatedAt,
            source: doc.source,
            confirmed: true,
        };
    } else {
        // Thử tìm trong Redis snapshot
        const book = await readExchangeBook(account);
        if (book) {
            const orders = kind === "algo"
                ? (book.algoOrders || [])
                : (book.openOrders || []);
            const found = orders.find((row) => {
                const id = kind === "algo" ? (row.algoId || row.strategyId) : row.orderId;
                return String(id) === orderId && String(row.symbol || "").toUpperCase() === symbol;
            });
            if (found) {
                order = kind === "algo"
                    ? normalizeAlgoOrder(found, account)
                    : normalizeRegularOrder(found, account);
            }
        }
    }

    if (!order) {
        throw httpError(404, "Không tìm thấy order");
    }

    // Lấy fills liên quan
    const fills = await ExchangeFill.find({
        username: account,
        symbol,
        orderId,
    }).sort({ time: -1 }).limit(100).lean();

    return {
        order,
        fills: fills.map((fill) => ({
            tradeId: fill.tradeId,
            orderId: fill.orderId,
            symbol: fill.symbol,
            positionSide: fill.positionSide,
            side: fill.side,
            price: fill.price,
            qty: fill.qty,
            quoteQty: fill.quoteQty,
            realizedPnl: fill.realizedPnl,
            commission: fill.commission,
            commissionAsset: fill.commissionAsset,
            time: fill.time,
        })),
    };
}

/**
 * Filter orders theo query.
 */
function filterOrders(orders, query = {}) {
    const symbol = String(query.symbol || "").trim().toUpperCase();
    const kind = String(query.kind || "").trim().toLowerCase();
    const side = String(query.side || "").trim().toUpperCase();
    const positionSide = String(query.positionSide || "").trim().toUpperCase();
    const type = String(query.type || "").trim().toUpperCase();
    const status = String(query.status || "").trim().toUpperCase();

    return orders.filter((order) => {
        if (symbol && !String(order.symbol || "").toUpperCase().includes(symbol)) return false;
        if (kind && order.kind !== kind) return false;
        if (side && order.side !== side) return false;
        if (positionSide && order.positionSide !== positionSide) return false;
        if (type && order.type !== type) return false;
        if (status && order.status !== status) return false;
        return true;
    });
}

/**
 * Sort orders.
 */
function sortOrders(orders, sortKey = "updateTime", dir = "desc") {
    const mult = dir === "asc" ? 1 : -1;
    return [...orders].sort((a, b) => {
        let va, vb;
        switch (sortKey) {
            case "symbol":
                va = a.symbol || "";
                vb = b.symbol || "";
                return mult * va.localeCompare(vb);
            case "side":
                va = a.side || "";
                vb = b.side || "";
                return mult * va.localeCompare(vb);
            case "type":
                va = a.type || "";
                vb = b.type || "";
                return mult * va.localeCompare(vb);
            case "price":
                va = num(a.price);
                vb = num(b.price);
                return mult * (va - vb);
            case "qty":
                va = num(a.origQty);
                vb = num(b.origQty);
                return mult * (va - vb);
            case "time":
            case "createdAt":
                va = new Date(a.time || 0).getTime();
                vb = new Date(b.time || 0).getTime();
                return mult * (va - vb);
            case "updateTime":
            default:
                va = new Date(a.updateTime || 0).getTime();
                vb = new Date(b.updateTime || 0).getTime();
                return mult * (va - vb);
        }
    });
}

/**
 * Upsert order event vào Mongo (dùng cho consumer user stream / reconcile).
 */
async function upsertOrderEvent(data, deps = {}) {
    const ExchangeOrderEvent = deps.ExchangeOrderEvent || require("../models/exchange-order-event");

    const key = {
        username: data.username,
        kind: data.kind,
        symbol: data.symbol,
        orderId: data.orderId,
    };

    const update = {
        $set: {
            clientOrderId: data.clientOrderId || null,
            positionSide: data.positionSide || "BOTH",
            side: data.side,
            type: data.type,
            status: data.status,
            price: data.price,
            triggerPrice: data.triggerPrice,
            origQty: data.origQty,
            executedQty: data.executedQty,
            avgPrice: data.avgPrice,
            reduceOnly: data.reduceOnly === true,
            closePosition: data.closePosition === true,
            timeInForce: data.timeInForce,
            workingType: data.workingType,
            exchangeUpdatedAt: data.exchangeUpdatedAt || data.updateTime || new Date(),
            lastEventTime: data.lastEventTime || Date.now(),
            source: data.source || "reconcile",
            rawCode: data.rawCode,
        },
        $setOnInsert: {
            exchangeCreatedAt: data.exchangeCreatedAt || data.time || new Date(),
        },
    };

    return ExchangeOrderEvent.findOneAndUpdate(key, update, { upsert: true, new: true });
}

/**
 * Upsert fill vào Mongo.
 */
async function upsertFill(data, deps = {}) {
    const ExchangeFill = deps.ExchangeFill || require("../models/exchange-fill");

    const key = {
        username: data.username,
        symbol: data.symbol,
        tradeId: data.tradeId,
    };

    const update = {
        $set: {
            orderId: data.orderId,
            positionSide: data.positionSide || "BOTH",
            side: data.side,
            price: data.price,
            qty: data.qty,
            quoteQty: data.quoteQty,
            realizedPnl: data.realizedPnl,
            commission: data.commission,
            commissionAsset: data.commissionAsset,
            time: data.time || new Date(),
            source: data.source || "reconcile",
        },
    };

    return ExchangeFill.findOneAndUpdate(key, update, { upsert: true, new: true });
}

module.exports = {
    loadOpenOrders,
    loadOrderHistory,
    getOrderDetail,
    upsertOrderEvent,
    upsertFill,
    normalizeRegularOrder,
    normalizeAlgoOrder,
    isOpenOrder,
    isTerminalOrder,
    visibleBots,
};
