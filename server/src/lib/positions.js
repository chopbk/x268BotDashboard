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

function isClosedDoc(doc) {
    return doc?.closed === true || doc?.isClosed === true;
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
        recorded: recordedFromDoc(doc),
        expectedOrders: expectedOrders(doc),
    };
}

function recordedFromDoc(doc) {
    const stats = doc?.stats;
    if (!stats || typeof stats !== "object") return null;
    const present = ["realizedPnl", "commission", "funding"].filter((key) => stats[key] != null && stats[key] !== "" && Number(stats[key]) !== 0);
    if (!present.length) return null;
    const realized = num(stats.realizedPnl);
    const fee = num(stats.commission);
    const funding = num(stats.funding);
    return { realized, fee, funding, net: realized + fee + funding };
}

function attachRecorded(parent) {
    const parts = (parent.monitors || []).map((monitor) => monitor.recorded).filter(Boolean);
    if (!parts.length) {
        parent.recorded = null;
        parent.recordedNet = null;
        return;
    }
    const realized = parts.reduce((sum, part) => sum + part.realized, 0);
    const fee = parts.reduce((sum, part) => sum + part.fee, 0);
    const funding = parts.reduce((sum, part) => sum + part.funding, 0);
    parent.recorded = { realized, fee, funding, net: realized + fee + funding };
    parent.recordedNet = parent.recorded.net;
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

function applyLiveMarks(rows, priceOf) {
    if (typeof priceOf !== "function") return { rows, priced: false };
    let priced = false;
    const next = rows.map((row) => {
        if (row.closedOnExchange) return row;
        const mark = num(priceOf(row.symbol)) || null;
        if (!mark) return row;
        priced = true;
        const qty = row.exchangeQty != null
            ? row.exchangeQty
            : row.monitors.reduce((sum, monitor) => sum + num(monitor.ownQty), 0);
        return {
            ...row,
            mark,
            unrealized: estimatedPnl(row.side, row.entry, mark, qty),
            monitors: row.monitors.map((monitor) => ({
                ...monitor,
                estimatedPnl: estimatedPnl(row.side, monitor.entry, mark, monitor.ownQty),
            })),
        };
    });
    return { rows: next, priced };
}

const EXCHANGE_MAX_AGE_MS = 15 * 60 * 1000;

function asExchangeBook(snap) {
    if (!snap || snap.error || snap.source === "monitor") return null;
    if (snap.source === "rest" || snap.source === "exchange") {
        if (!Array.isArray(snap.positions)) return null;
        return snap;
    }
    const usable = usableExchangeSnap(snap);
    if (!usable || usable.source === "monitor") return null;
    return usable;
}

function freshExchangeBook(snap, now = Date.now(), maxAge = EXCHANGE_MAX_AGE_MS) {
    const book = asExchangeBook(snap);
    if (!book) return null;
    const age = ageMs(book.at, now);
    if (age == null || age < 0 || age > maxAge) return null;
    return book;
}

async function eachLimit(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    async function worker() {
        while (next < items.length) {
            const index = next;
            next += 1;
            results[index] = await fn(items[index]);
        }
    }
    const width = Math.max(1, Math.min(limit, items.length));
    if (items.length) await Promise.all(Array.from({ length: width }, () => worker()));
    return results;
}

function usableExchangeSnap(snap) {
    if (!snap || typeof snap !== "object" || snap.error) return null;
    if (snap.source === "monitor") return snap;
    if (snap.stale === true || snap.status === "stale") return null;
    if (snap.source === "rest" || snap.status === "live" || snap.status === "polling") return snap;
    if (Array.isArray(snap.positions) && snap.positions.length > 0) return snap;
    return null;
}

function applyMonitorQuote(parent, doc) {
    const pos = doc?.position && typeof doc.position === "object" ? doc.position : {};
    const entry = num(pos.entryPrice) || null;
    const mark = num(pos.markPrice) || null;
    const snap = Math.abs(num(pos.positionAmt));
    const qty = snap > QTY_EPS ? snap : ownQty(doc);
    if (parent.entry == null && entry) parent.entry = entry;
    if (parent.mark == null && mark) parent.mark = mark;
    if (parent.leverage == null && pos.leverage != null && pos.leverage !== "") parent.leverage = num(pos.leverage) || null;
    if (parent.liquidation == null) {
        const liq = num(pos.liquidationPrice) || null;
        if (liq) parent.liquidation = liq;
    }
    if (parent.exchangeQty == null && qty > QTY_EPS) parent.exchangeQty = qty;
    if (parent.unrealized == null) {
        parent.unrealized = pos.unRealizedProfit == null || pos.unRealizedProfit === ""
            ? estimatedPnl(parent.side, entry, mark, qty || ownQty(doc))
            : num(pos.unRealizedProfit);
    }
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
    income = [],
}) {
    const parents = [];
    const used = new Set();
    const live = (Array.isArray(exchangePositions) ? exchangePositions : [])
        .map((row) => ({ row, identity: exchangeIdentity(row) }))
        .filter((item) => item.identity.symbol && item.identity.side && Math.abs(num(item.row.positionAmt)) > QTY_EPS);

    for (const item of live) {
        const parent = parentFromExchange(account, item.row, connection);
        monitors.forEach((doc, index) => {
            if (isPaper(doc) || isPending(doc) || isClosedDoc(doc)) return;
            if (!samePosition(item.identity, monitorIdentity(doc))) return;
            parent.monitors.push(publicMonitor(doc, heartbeatFresh, now, parent.mark));
            used.add(index);
        });
        const managed = parent.monitors.reduce((sum, monitor) => sum + monitor.ownQty, 0);
        if (!parent.monitors.length) parent.warnings.push("no-monitor");
        if (Math.abs(managed - parent.exchangeQty) > QTY_EPS) parent.warnings.push("qty-mismatch");
        parent.notpsl = parent.monitors.some((monitor) => monitor.notpsl);
        attachRecorded(parent);
        parents.push(parent);
    }

    monitors.forEach((doc, index) => {
        if (used.has(index) || isClosedDoc(doc)) return;
        const identity = monitorIdentity(doc);
        if (!identity.symbol || !identity.side) return;
        const book = isPaper(doc) ? "paper" : isPending(doc) ? "pending" : "live";
        const parent = emptyParent(account, identity, book, connection);
        const monitor = publicMonitor(doc, heartbeatFresh, now, null);
        parent.monitors.push(monitor);
        parent.notpsl = monitor.notpsl;
        if (book === "live" && exchangeLoaded) {
            parent.warnings.push("closed-on-exchange");
            parent.closedOnExchange = true;
        } else if (!exchangeLoaded) {
            applyMonitorQuote(parent, doc);
        }
        attachRecorded(parent);
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
        attachRecorded(parent);
        parents.push(parent);
        placed.add(`${identity.symbol}|${identity.side}`);
    }
    for (const parent of parents) applyIncome(parent, income);
    return parents;
}

function applyIncome(parent, income) {
    const opened = (parent.monitors || [])
        .map((monitor) => new Date(monitor.openedAt).getTime())
        .filter((time) => time > 0);
    const since = opened.length ? Math.min(...opened) : 0;
    const rows = (Array.isArray(income) ? income : []).filter((row) => {
        if (String(row?.symbol || "").toUpperCase() !== parent.symbol) return false;
        if (!since) return true;
        const time = Number(row?.time);
        return time >= since;
    });
    if (!rows.length) return;
    let realized = 0;
    let fee = 0;
    let funding = 0;
    let any = false;
    for (const row of rows) {
        const amount = num(row.income);
        const type = String(row.incomeType || "");
        if (type === "REALIZED_PNL") realized += amount;
        else if (type === "COMMISSION") fee += amount;
        else if (type === "FUNDING_FEE") funding += amount;
        else continue;
        any = true;
    }
    if (!any) return;
    parent.recorded = { realized, fee, funding, net: realized + fee + funding, source: "income" };
    parent.recordedNet = parent.recorded.net;
}

function filterRows(rows, query = {}) {
    const symbol = String(query.symbol || "").trim().toUpperCase();
    const signal = String(query.signal || "").trim().toUpperCase();
    const side = String(query.side || "").trim().toUpperCase();
    const book = String(query.book || "").trim().toLowerCase();
    const env = String(query.env || "").trim();
    const warn = String(query.warn || "") === "1";
    return rows.filter((row) => {
        if (symbol && !String(row.symbol || "").toUpperCase().includes(symbol)) return false;
        if (signal && !(row.monitors || []).some((monitor) => `${monitor.signal || ""} ${monitor.type || ""}`.toUpperCase().includes(signal))) return false;
        if (side && row.side !== side) return false;
        if (book === "all") {
            // giữ live và paper
        } else if (book === "notpsl") {
            if (!row.notpsl && !row.monitors.some((monitor) => monitor.notpsl)) return false;
        } else if (book === "paper" || book === "pending") {
            if (row.book !== book) return false;
        } else if (row.book === "paper") return false;
        if (env && !row.monitors.some((monitor) => monitor.env === env)) return false;
        if (warn && !row.warnings.length) return false;
        return true;
    });
}

function isMine(actor, bot) {
    const username = bot?.username;
    if (!username || !actor) return false;
    const ownerUserId = bot.ownerUserId ? String(bot.ownerUserId) : "";
    if (ownerUserId && ownerUserId === String(actor.id || "")) return true;
    if (!ownerUserId && [actor.username, actor.email].filter(Boolean).includes(String(username))) return true;
    return (actor.botUsernames || []).includes(username);
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

async function visibleBots(actor, UserAccount, audience = "mine") {
    const rows = await UserAccount.find().select("username accounts ownerUserId visibility active").lean();
    return (rows || []).filter((row) => {
        if (!row?.username || row.active === false) return false;
        if (!canAccessResource(actor, PERMISSIONS.POSITIONS_VIEW, row)) return false;
        if (audience === "all") return true;
        return isMine(actor, row);
    });
}

async function loadPositions(actor, query = {}, deps = {}) {
    const UserAccount = deps.UserAccount || require("../models/user-account");
    const Monitor = deps.Monitor || require("../models/monitor-position");
    const Heartbeat = deps.Heartbeat || require("../models/process-heartbeat");
    const now = deps.now || Date.now();
    const audience = query.audience === "all" ? "all" : "mine";
    const bots = await visibleBots(actor, UserAccount, audience);
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
            isClosed: { $ne: true },
            $or: [{ futuresClientName: { $in: selected } }, { env: { $in: envs.length ? envs : ["__none__"] } }],
        }).lean()
        : [];
    const monitors = (found || []).filter((doc) => selected.includes(monitorOwner(doc, envOwners)));
    const beats = await Heartbeat.find({ "flags.monitor": true }).select("at flags").lean();
    const fresh = heartbeatFresh(beats, now);
    let connection = account ? "monitor" : "idle";
    let updatedAt = null;
    let stale = false;
    let snap = null;
    if (account && deps.snapshot) {
        try {
            snap = usableExchangeSnap(await deps.snapshot(account));
            if (snap) {
                connection = snap.status || (snap.source === "monitor" ? "live" : "snapshot");
                updatedAt = snap.at || null;
                stale = snap.stale === true || snap.status === "stale";
            }
        } catch (error) {
            console.error("[loadPositions]", error.message);
        }
    }
    const grouped = new Map(selected.map((name) => [name, []]));
    for (const doc of monitors) {
        const owner = monitorOwner(doc, envOwners);
        if (!grouped.has(owner)) grouped.set(owner, []);
        grouped.get(owner).push(doc);
    }
    const force = query.refresh === "1" || query.refresh === "true";
    const maxAge = deps.exchangeMaxAgeMs || EXCHANGE_MAX_AGE_MS;
    const books = new Map();
    const remembered = new Map();
    const keepBook = (name, raw) => {
        const book = asExchangeBook(raw);
        if (!book) return;
        remembered.set(name, book);
        if (!force && freshExchangeBook(book, now, maxAge)) books.set(name, book);
    };
    if (account) keepBook(account, snap);
    if (!account && deps.snapshots) {
        try {
            const extra = await deps.snapshots(selected);
            for (const [name, book] of Object.entries(extra || {})) keepBook(name, book);
        } catch (error) {
            console.error("[loadPositions]", error.message);
        }
    }
    const exchangeErrors = [];
    const needExchange = deps.exchange ? (force ? selected : selected.filter((name) => !books.has(name))) : [];
    if (needExchange.length) {
        const fetched = await eachLimit(needExchange, 4, async (name) => {
            try {
                return { name, book: await deps.exchange(name) };
            } catch (error) {
                console.error("[loadPositions]", `${name} ${error.message}`);
                return { name, error: error.message || "Không lấy được sổ sàn" };
            }
        });
        for (const item of fetched) {
            const book = asExchangeBook(item.book);
            if (book) {
                books.set(item.name, book);
                if (deps.saveExchange) {
                    try {
                        await deps.saveExchange(item.name, book);
                    } catch (error) {
                        console.error("[loadPositions]", error.message);
                    }
                }
            } else if (item.error) exchangeErrors.push({ account: item.name, error: item.error });
        }
    }
    for (const name of selected) {
        if (!books.has(name) && remembered.has(name)) books.set(name, { ...remembered.get(name), stale: true });
    }
    const rows = [];
    for (const name of selected) {
        const current = books.get(name) || null;
        const fromMonitor = current?.source === "monitor" && ageMs(current.at, now) != null && ageMs(current.at, now) <= HEARTBEAT_MS;
        rows.push(...buildPositionView({
            account: name,
            monitors: grouped.get(name) || [],
            exchangePositions: current?.positions || [],
            openOrders: current?.openOrders || [],
            algoOrders: current?.algoOrders || [],
            income: current?.income || [],
            heartbeatFresh: fromMonitor || fresh,
            now,
            connection: current?.stale ? "stale" : (name === account ? connection : "idle"),
            exchangeLoaded: Boolean(current),
        }));
    }
    const viewed = filterRows(rows, query);
    const priced = applyLiveMarks(viewed, deps.priceOf);
    return {
        accounts: bots.map((row) => ({ username: row.username, accounts: row.accounts || [] })),
        rows: priced.rows,
        connection,
        updatedAt,
        stale,
        audience,
        exchangeErrors,
        priceFeed: priced.priced ? "live" : "idle",
        version: snap?.version == null ? null : Number(snap.version),
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

async function createMonitorRecord(actor, input, deps = {}) {
    const UserAccount = deps.UserAccount || require("../models/user-account");
    const Monitor = deps.Monitor || require("../models/monitor-position");
    const AccountConfig = deps.AccountConfig || require("../models/account-config");
    const env = String(input?.env || "").trim();
    const symbol = String(input?.symbol || "").trim().toUpperCase();
    const side = String(input?.side || "").trim().toUpperCase();
    const signal = String(input?.signal || "NOTPSL").trim() || "NOTPSL";
    if (!env || !symbol || (side !== "LONG" && side !== "SHORT")) {
        throw httpError(400, "Cần env, symbol và side LONG hoặc SHORT");
    }
    const accounts = await UserAccount.find().select("username accounts ownerUserId visibility active").lean();
    const active = (accounts || []).filter((row) => row?.username && row.active !== false);
    const owner = active.find((row) => row.username === env || (row.accounts || []).includes(env));
    if (!owner || !canAccessResource(actor, PERMISSIONS.POSITIONS_OPEN, owner)) {
        throw httpError(403, "Không có quyền thêm monitor cho config này");
    }
    const existing = await Monitor.countDocuments({ env, symbol, side, closed: { $ne: true } });
    if (existing) throw httpError(409, "Config này đã có monitor mở cho vị thế");
    const configDoc = await AccountConfig.findOne({ env }).select("trade_config").lean();
    const trade = configDoc?.trade_config;
    if (!trade || typeof trade !== "object") throw httpError(400, "Config chưa có trade_config");
    const qty = Math.abs(num(input?.positionAmt));
    const saved = await Monitor.create({
        symbol,
        side,
        prices: {},
        orders: {},
        startTime: new Date(),
        futuresLeverage: side === "SHORT" ? trade.SHORT_LEVERAGE : trade.LONG_LEVERAGE,
        type: signal,
        signal,
        isLimit: false,
        isPaper: trade.PAPER === true,
        config: trade,
        position: {
            symbol,
            positionSide: side,
            positionAmt: input?.positionAmt ?? "",
            entryPrice: input?.entry ?? "",
            markPrice: input?.mark ?? "",
            leverage: input?.leverage ?? "",
            liquidationPrice: input?.liquidation ?? "",
        },
        positionAmt: qty,
        env,
        closed: false,
        futuresClientName: owner.username,
        isCopy: false,
    });
    return {
        id: String(saved._id),
        account: owner.username,
        env,
        symbol,
        side,
        signal,
        monitorOff: trade.MONITOR === false,
        row: {
            id: String(saved._id),
            env,
            signal,
            type: signal,
            notpsl: signal.toUpperCase() === "NOTPSL",
            paper: trade.PAPER === true,
            pending: false,
            ownQty: qty,
            exchangeSnapshotQty: qty,
            openedAt: saved.startTime,
            closed: false,
        },
    };
}

async function deleteMonitorRecord(actor, id, deps = {}) {
    const UserAccount = deps.UserAccount || require("../models/user-account");
    const Monitor = deps.Monitor || require("../models/monitor-position");
    const doc = await Monitor.findById(id).lean();
    if (!doc) throw httpError(404, "Không tìm thấy monitor");
    const accounts = await UserAccount.find().select("username accounts ownerUserId visibility active").lean();
    const active = (accounts || []).filter((row) => row?.username && row.active !== false);
    const named = String(doc.futuresClientName || "").trim();
    const owner = active.find((row) => row.username === named)
        || active.find((row) => (row.accounts || []).includes(doc.env));
    if (!owner || !canAccessResource(actor, PERMISSIONS.POSITIONS_CLOSE, owner)) {
        throw httpError(403, "Không có quyền xoá monitor này");
    }
    await Monitor.deleteOne({ _id: doc._id });
    return {
        id: String(doc._id),
        account: owner.username,
        env: doc.env || "",
        symbol: String(doc.symbol || "").toUpperCase(),
        side: String(doc.side || "").toUpperCase(),
    };
}

module.exports = {
    HEARTBEAT_MS,
    EXCHANGE_MAX_AGE_MS,
    buildPositionView,
    applyLiveMarks,
    filterRows,
    isMine,
    estimatedPnl,
    loadPositions,
    monitorDetail,
    monitorOwner,
    heartbeatFresh,
    visibleBots,
    deleteMonitorRecord,
    createMonitorRecord,
};
