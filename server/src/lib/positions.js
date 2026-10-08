const { PERMISSIONS, canAccessResource } = require("../auth/access-control");
const { httpError } = require("./http");

const HEARTBEAT_MS = 90 * 1000;
const QTY_EPS = 1e-8;
const SECRET = /api|secret|password|token|listenkey|signature/i;

function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function ageMs(value, now) {
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? now - time : null;
}

function sideFromAmount(amount) {
    if (amount < 0) return "SHORT";
    if (amount > 0) return "LONG";
    return "";
}

function exchangeIdentity(row) {
    const mode = String(row?.positionSide || "BOTH").toUpperCase();
    const hedge = mode === "LONG" || mode === "SHORT";
    const amount = num(row?.positionAmt);
    return {
        symbol: String(row?.symbol || "").toUpperCase(),
        side: hedge ? mode : sideFromAmount(amount),
        mode: hedge ? mode : "BOTH",
    };
}

function monitorIdentity(doc) {
    const mode = String(doc?.position?.positionSide || "BOTH").toUpperCase();
    const hedge = mode === "LONG" || mode === "SHORT";
    return {
        symbol: String(doc?.symbol || "").toUpperCase(),
        side: String(doc?.side || "").toUpperCase(),
        mode: hedge ? mode : "BOTH",
    };
}

function samePosition(left, right) {
    if (!left.symbol || left.symbol !== right.symbol || !left.side || left.side !== right.side) return false;
    if (left.mode !== "BOTH" && right.mode !== "BOTH" && left.mode !== right.mode) return false;
    return true;
}

function rowKey(account, identity) {
    return `${account}|${identity.symbol}|${identity.side}|${identity.mode}`;
}

function isPaper(doc) {
    return doc?.isPaper === true || doc?.config?.PAPER === true;
}

function isPending(doc) {
    return doc?.isLimit === true && !isPaper(doc);
}

function isNotpsl(doc) {
    return String(doc?.type || doc?.signal || "").toUpperCase() === "NOTPSL";
}

function ownQty(doc) {
    return Math.abs(num(doc?.positionAmt));
}

function snapshotQty(doc) {
    return Math.abs(num(doc?.position?.positionAmt));
}

function pick(source, keys) {
    for (const key of keys) {
        const value = source?.[key];
        if (value != null && value !== "") return value;
    }
    return null;
}

function labelOf(value) {
    if (value == null || value === "") return null;
    if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return String(value);
    if (typeof value === "object") {
        const price = value.price ?? value.stopPrice ?? value.triggerPrice ?? value.value;
        if (price != null && price !== "") return String(price);
    }
    return null;
}

function estimatedPnl(side, entry, mark, qty) {
    const quantity = Math.abs(num(qty));
    const entryPrice = num(entry);
    const markPrice = num(mark);
    if (!quantity || !entryPrice || !markPrice) return null;
    const sign = side === "SHORT" ? -1 : 1;
    return (markPrice - entryPrice) * quantity * sign;
}

function sanitize(value, depth = 0) {
    if (value == null || depth > 4) return null;
    if (Array.isArray(value)) return value.slice(0, 40).map((item) => sanitize(item, depth + 1));
    if (typeof value !== "object") return value;
    const out = {};
    for (const [key, item] of Object.entries(value)) {
        if (SECRET.test(key)) continue;
        out[key] = sanitize(item, depth + 1);
    }
    return out;
}

function expectedOrders(doc) {
    const orders = doc?.orders && typeof doc.orders === "object" ? doc.orders : {};
    return Object.entries(orders).flatMap(([key, value]) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return [];
        return [{
            id: String(value.orderId || value.algoId || key),
            kind: key,
            source: "monitor",
            confirmed: false,
            type: value.type || value.orderType || key,
            price: num(value.price || value.stopPrice || value.triggerPrice) || null,
            qty: num(value.origQty || value.quantity || value.qty) || null,
            status: value.status || value.algoStatus || "expected",
        }];
    });
}

function publicMonitor(doc, heartbeatFresh, now, mark) {
    const identity = monitorIdentity(doc);
    const updatedAt = doc.updatedAt || doc.stats?.at || null;
    const freshDoc = ageMs(updatedAt, now);
    const watching = doc.closed !== true && heartbeatFresh === true && freshDoc != null && freshDoc <= HEARTBEAT_MS;
    const entry = num(doc.position?.entryPrice) || null;
    return {
        id: String(doc._id || ""),
        env: doc.env || "",
        signal: doc.signal || doc.typeSignal || "",
        type: doc.type || "",
        notpsl: isNotpsl(doc),
        paper: isPaper(doc),
        pending: isPending(doc),
        ownQty: ownQty(doc),
        exchangeSnapshotQty: snapshotQty(doc),
        entry,
        sl: labelOf(pick(doc.orders, ["stopLoss", "sl", "SL"]) || pick(doc.config, ["SL", "sl"])),
        tp: labelOf(pick(doc.orders, ["takeProfit", "tp", "TP"]) || pick(doc.config, ["TP", "tp"])),
        trailing: labelOf(pick(doc.config, ["TRAILING", "trailing", "TRAIL"])),
        hp: labelOf(pick(doc.config, ["HP", "hp", "HIGH_PROFIT"])),
        openedAt: doc.startTime || doc.createdAt || null,
        updatedAt,
        watching,
        closed: doc.closed === true,
        estimatedPnl: estimatedPnl(identity.side, entry, mark, ownQty(doc)),
        estimatedLabel: "ước tính",
        expectedOrders: expectedOrders(doc),
    };
}

function publicOrder(row, kind) {
    return {
        id: String(row.orderId || row.algoId || ""),
        kind,
        source: "exchange",
        confirmed: true,
        symbol: String(row.symbol || "").toUpperCase(),
        side: String(row.side || "").toUpperCase(),
        positionSide: String(row.positionSide || "BOTH").toUpperCase(),
        type: row.type || row.orderType || "",
        price: num(row.price || row.triggerPrice) || null,
        stopPrice: num(row.stopPrice || row.triggerPrice) || null,
        qty: num(row.origQty || row.quantity) || null,
        status: row.status || row.algoStatus || "",
        reduceOnly: row.reduceOnly === true,
    };
}

function orderMatches(order, identity) {
    if (order.symbol !== identity.symbol) return false;
    const mode = order.positionSide === "LONG" || order.positionSide === "SHORT" ? order.positionSide : "BOTH";
    if (mode !== "BOTH") return mode === identity.side;
    if (order.reduceOnly) return (identity.side === "LONG" && order.side === "SELL") || (identity.side === "SHORT" && order.side === "BUY");
    return (identity.side === "LONG" && order.side === "BUY") || (identity.side === "SHORT" && order.side === "SELL") || !order.side;
}

function parentFromExchange(account, row, connection) {
    const identity = exchangeIdentity(row);
    const qty = Math.abs(num(row.positionAmt));
    return {
        key: rowKey(account, identity),
        book: "live",
        account,
        symbol: identity.symbol,
        side: identity.side,
        mode: identity.mode,
        exchangeQty: qty,
        entry: num(row.entryPrice) || null,
        mark: num(row.markPrice) || null,
        unrealized: row.unRealizedProfit == null || row.unRealizedProfit === ""
            ? estimatedPnl(identity.side, row.entryPrice, row.markPrice, qty)
            : num(row.unRealizedProfit),
        leverage: row.leverage == null || row.leverage === "" ? null : num(row.leverage),
        liquidation: num(row.liquidationPrice) || null,
        exchangeLoaded: true,
        warnings: connection === "stale" ? ["stale"] : [],
        monitors: [],
        exchangeOrders: [],
        algoOrders: [],
        notpsl: false,
    };
}

function emptyParent(account, identity, book, connection) {
    return {
        key: `${rowKey(account, identity)}|${book}`,
        book,
        account,
        symbol: identity.symbol,
        side: identity.side,
        mode: identity.mode,
        exchangeQty: null,
        entry: null,
        mark: null,
        unrealized: null,
        leverage: null,
        liquidation: null,
        exchangeLoaded: false,
        warnings: connection === "stale" ? ["stale"] : [],
        monitors: [],
        exchangeOrders: [],
        algoOrders: [],
        notpsl: false,
    };
}

function buildPositionView({
    account,
    monitors = [],
    exchangePositions = [],
    openOrders = [],
    algoOrders = [],
    heartbeatFresh = false,
    now = Date.now(),
    connection = "snapshot",
    exchangeLoaded = false,
}) {
    const parents = [];
    const used = new Set();
    const live = (Array.isArray(exchangePositions) ? exchangePositions : [])
        .map((row) => ({ row, identity: exchangeIdentity(row) }))
        .filter((item) => item.identity.symbol && item.identity.side && Math.abs(num(item.row.positionAmt)) > QTY_EPS);

    for (const item of live) {
        const parent = parentFromExchange(account, item.row, connection);
        monitors.forEach((doc, index) => {
            if (isPaper(doc) || isPending(doc) || doc.closed === true) return;
            if (!samePosition(item.identity, monitorIdentity(doc))) return;
            parent.monitors.push(publicMonitor(doc, heartbeatFresh, now, parent.mark));
            used.add(index);
        });
        const managed = parent.monitors.reduce((sum, monitor) => sum + monitor.ownQty, 0);
        if (!parent.monitors.length) parent.warnings.push("no-monitor");
        if (Math.abs(managed - parent.exchangeQty) > QTY_EPS) parent.warnings.push("qty-mismatch");
        parent.notpsl = parent.monitors.some((monitor) => monitor.notpsl);
        parents.push(parent);
    }

    monitors.forEach((doc, index) => {
        if (used.has(index) || doc.closed === true) return;
        const identity = monitorIdentity(doc);
        if (!identity.symbol || !identity.side) return;
        const book = isPaper(doc) ? "paper" : isPending(doc) ? "pending" : "live";
        const parent = emptyParent(account, identity, book, connection);
        const monitor = publicMonitor(doc, heartbeatFresh, now, null);
        parent.monitors.push(monitor);
        parent.notpsl = monitor.notpsl;
        if (book === "live") parent.warnings.push("monitor-without-position");
        parents.push(parent);
    });

    const orders = [
        ...(Array.isArray(openOrders) ? openOrders : []).map((row) => publicOrder(row, "order")),
        ...(Array.isArray(algoOrders) ? algoOrders : []).map((row) => publicOrder(row, "algo")),
    ];
    for (const parent of parents) {
        const identity = { symbol: parent.symbol, side: parent.side, mode: parent.mode };
        const matched = orders.filter((order) => orderMatches(order, identity));
        parent.exchangeOrders = matched.filter((order) => order.kind === "order");
        parent.algoOrders = matched.filter((order) => order.kind === "algo");
    }
    const placed = new Set(parents.filter((parent) => parent.book === "live" && parent.exchangeQty != null).map((parent) => `${parent.symbol}|${parent.side}`));
    for (const order of orders) {
        if (order.reduceOnly) continue;
        const identity = {
            symbol: order.symbol,
            side: order.positionSide === "LONG" || order.positionSide === "SHORT"
                ? order.positionSide
                : (order.side === "SELL" ? "SHORT" : "LONG"),
            mode: order.positionSide === "LONG" || order.positionSide === "SHORT" ? order.positionSide : "BOTH",
        };
        if (!identity.symbol || placed.has(`${identity.symbol}|${identity.side}`)) continue;
        if (parents.some((parent) => parent.symbol === identity.symbol && parent.side === identity.side)) continue;
        const key = `${rowKey(account, identity)}|pending|${order.id}`;
        if (parents.some((parent) => parent.key === key)) continue;
        const parent = emptyParent(account, identity, "pending", connection);
        parent.key = key;
        if (order.kind === "algo") parent.algoOrders = [order];
        else parent.exchangeOrders = [order];
        parents.push(parent);
        placed.add(`${identity.symbol}|${identity.side}`);
    }
    return parents;
}

function filterRows(rows, query = {}) {
    const symbol = String(query.symbol || "").trim().toUpperCase();
    const side = String(query.side || "").trim().toUpperCase();
    const book = String(query.book || "").trim().toLowerCase();
    const env = String(query.env || "").trim();
    const warn = String(query.warn || "") === "1";
    return rows.filter((row) => {
        if (symbol && row.symbol !== symbol) return false;
        if (side && row.side !== side) return false;
        if (book === "notpsl") {
            if (!row.notpsl && !row.monitors.some((monitor) => monitor.notpsl)) return false;
        } else if (book && row.book !== book) return false;
        if (env && !row.monitors.some((monitor) => monitor.env === env)) return false;
        if (warn && !row.warnings.length) return false;
        return true;
    });
}

function monitorOwner(doc, envOwners) {
    const named = String(doc?.futuresClientName || "").trim();
    if (named) return named;
    return envOwners.get(doc?.env) || "";
}

function heartbeatFresh(beats, now) {
    return (Array.isArray(beats) ? beats : []).some((beat) => {
        if (beat?.flags?.monitor !== true) return false;
        const elapsed = ageMs(beat.at, now);
        return elapsed != null && elapsed <= HEARTBEAT_MS;
    });
}

async function visibleBots(actor, UserAccount) {
    const rows = await UserAccount.find().select("username accounts ownerUserId visibility active").lean();
    return (rows || []).filter((row) => row?.username && canAccessResource(actor, PERMISSIONS.POSITIONS_VIEW, row));
}

async function loadPositions(actor, query = {}, deps = {}) {
    const UserAccount = deps.UserAccount || require("../models/user-account");
    const Monitor = deps.Monitor || require("../models/monitor-position");
    const Heartbeat = deps.Heartbeat || require("../models/process-heartbeat");
    const now = deps.now || Date.now();
    const bots = await visibleBots(actor, UserAccount);
    const names = bots.map((row) => row.username);
    const account = String(query.account || "").trim();
    if (account && !names.includes(account)) throw httpError(403, "Không có quyền với tài khoản này");
    const selected = account ? [account] : names;
    const envOwners = new Map();
    for (const bot of bots) {
        for (const env of bot.accounts || []) envOwners.set(env, bot.username);
    }
    const envs = [...envOwners.entries()].filter(([, name]) => selected.includes(name)).map(([env]) => env);
    const found = selected.length
        ? await Monitor.find({
            closed: { $ne: true },
            $or: [{ futuresClientName: { $in: selected } }, { env: { $in: envs.length ? envs : ["__none__"] } }],
        }).lean()
        : [];
    const monitors = (found || []).filter((doc) => selected.includes(monitorOwner(doc, envOwners)));
    const beats = await Heartbeat.find({ "flags.monitor": true }).select("at flags").lean();
    const fresh = heartbeatFresh(beats, now);
    let connection = account ? "snapshot" : "idle";
    let updatedAt = null;
    let stale = false;
    let snap = null;
    if (account && deps.snapshot) {
        try {
            snap = await deps.snapshot(account);
            if (snap) {
                connection = snap.status || "snapshot";
                updatedAt = snap.at || null;
                stale = snap.stale === true || snap.status === "stale";
            }
        } catch (error) {
            console.error("[loadPositions]", error.message);
            connection = "stale";
            stale = true;
        }
    }
    const grouped = new Map(selected.map((name) => [name, []]));
    for (const doc of monitors) {
        const owner = monitorOwner(doc, envOwners);
        if (!grouped.has(owner)) grouped.set(owner, []);
        grouped.get(owner).push(doc);
    }
    const rows = [];
    for (const name of selected) {
        const current = name === account ? snap : null;
        rows.push(...buildPositionView({
            account: name,
            monitors: grouped.get(name) || [],
            exchangePositions: current?.positions || [],
            openOrders: current?.openOrders || [],
            algoOrders: current?.algoOrders || [],
            heartbeatFresh: fresh,
            now,
            connection: name === account ? connection : "idle",
            exchangeLoaded: Boolean(current),
        }));
    }
    return {
        accounts: bots.map((row) => ({ username: row.username, accounts: row.accounts || [] })),
        rows: filterRows(rows, query),
        connection,
        updatedAt,
        stale,
    };
}

function monitorDetail(doc, heartbeatFreshNow, now) {
    const view = publicMonitor(doc, heartbeatFreshNow, now, num(doc.position?.markPrice) || null);
    return {
        ...view,
        fills: sanitize(Array.isArray(doc.fills) ? doc.fills.slice(-40) : []),
        logs: sanitize(Array.isArray(doc.logs) ? doc.logs.slice(-40) : []),
        openLogs: sanitize(Array.isArray(doc.openLogs) ? doc.openLogs.slice(-40) : []),
        stats: sanitize(doc.stats || null),
        config: sanitize(doc.config || null),
    };
}

module.exports = {
    HEARTBEAT_MS,
    buildPositionView,
    filterRows,
    estimatedPnl,
    loadPositions,
    monitorDetail,
    monitorOwner,
    heartbeatFresh,
    visibleBots,
};
