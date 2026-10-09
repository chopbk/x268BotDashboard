const { snapshotKey, notifyChannel, parseNotice, decorateSnapshot, decideUpdate } = require("./position-cache");

const ORDER_KEY = "wb:ord:";
const ORDER_CHANNEL = "wb:ord:notify:";
const EXCHANGE_KEY = "wb:ex:";
const EXCHANGE_CHANNEL = "wb:ex:notify:";
const EXCHANGE_TTL_SEC = 20 * 60;
const QUOTE_MS = 15_000;
const EXCHANGE_REFRESH_MS = 15 * 60 * 1000;

const feeds = new Map();
let reader = null;
let subscriber = null;
let subscriberReady = null;

function feedFor(account) {
    if (!feeds.has(account)) {
        feeds.set(account, { viewers: new Set(), last: null, subscribed: false, polling: null, restAt: 0 });
    }
    return feeds.get(account);
}

function publish(feed) {
    for (const viewer of feed.viewers) {
        try {
            viewer(feed.last);
        } catch (error) {
            console.error("[positionLive]", error.message);
        }
    }
}

async function readRedis(account) {
    if (!reader?.isReady) return null;
    try {
        const raw = await reader.get(snapshotKey(account));
        if (!raw) return null;
        return decorateSnapshot(JSON.parse(raw));
    } catch (error) {
        console.error("[positionLive]", error.message);
        return null;
    }
}

async function readExchangeBook(account) {
    if (!reader?.isReady || !account) return null;
    try {
        const raw = await reader.get(EXCHANGE_KEY + account);
        if (!raw) return null;
        const book = JSON.parse(raw);
        if (!book || book.source !== "exchange" || !Array.isArray(book.positions)) return null;
        if (typeof reader.expire === "function") reader.expire(EXCHANGE_KEY + account, EXCHANGE_TTL_SEC).catch((error) => console.error("[positionLive]", error.message));
        return book;
    } catch (error) {
        console.error("[positionLive]", error.message);
        return null;
    }
}

async function readExchangeBooks(names) {
    if (!reader?.isReady || !names?.length) return {};
    try {
        const values = await reader.mGet(names.map((name) => EXCHANGE_KEY + name));
        const out = {};
        for (let index = 0; index < names.length; index += 1) {
            if (!values[index]) continue;
            try {
                const book = JSON.parse(values[index]);
                if (book?.source === "exchange" && Array.isArray(book.positions)) out[names[index]] = book;
            } catch (error) {
                console.error("[positionLive]", error.message);
            }
        }
        return out;
    } catch (error) {
        console.error("[positionLive]", error.message);
        return {};
    }
}

async function saveExchangeBook(account, book) {
    if (!reader?.isReady || !account || !book) return;
    const stored = {
        ...book,
        source: "exchange",
        account,
        at: book.at || new Date().toISOString(),
    };
    await reader.set(EXCHANGE_KEY + account, JSON.stringify(stored), { EX: EXCHANGE_TTL_SEC });
}

async function readOrders(account) {
    if (!reader?.isReady || !account || typeof reader.hGetAll !== "function") return [];
    try {
        const rows = await reader.hGetAll(ORDER_KEY + account);
        return Object.values(rows || {}).flatMap((raw) => {
            try {
                const order = JSON.parse(raw);
                return order?.orderId ? [order] : [];
            } catch (error) {
                console.error("[positionLive]", error.message);
                return [];
            }
        });
    } catch (error) {
        console.error("[positionLive]", error.message);
        return [];
    }
}

async function withOrders(account, snap) {
    if (!snap) return snap;
    const orders = await readOrders(account);
    if (!orders.length) return snap;
    return { ...snap, openOrders: orders };
}

async function readBooks(names) {
    if (!reader?.isReady || !names?.length) return {};
    try {
        const values = await reader.mGet(names.map((name) => snapshotKey(name)));
        const out = {};
        for (let index = 0; index < names.length; index += 1) {
            if (!values[index]) continue;
            try {
                out[names[index]] = await withOrders(names[index], decorateSnapshot(JSON.parse(values[index])));
            } catch (error) {
                console.error("[positionLive]", error.message);
            }
        }
        return out;
    } catch (error) {
        console.error("[positionLive]", error.message);
        return {};
    }
}

async function applyStored(account, notice) {
    const feed = feeds.get(account);
    if (!feed) return null;
    let stored = await readRedis(account);
    let decision = decideUpdate(feed.last, notice, stored);
    if (decision.action === "reread") {
        stored = await readRedis(account);
        decision = decideUpdate(feed.last, null, stored);
        if (!stored || (notice && Number(stored.version) < Number(notice.version))) {
            feed.last = { ...(feed.last || { positions: [], openOrders: [], algoOrders: [], monitors: [] }), stale: true, status: "stale" };
            publish(feed);
            return feed.last;
        }
    }
    if (decision.action === "keep") {
        feed.last = { ...(feed.last || { positions: [], openOrders: [], algoOrders: [], monitors: [] }), stale: true, status: "stale" };
        publish(feed);
        return feed.last;
    }
    if (decision.action === "send") {
        feed.last = decision.snapshot;
        publish(feed);
    }
    return feed.last;
}

async function ensureSubscriber() {
    if (subscriber?.isReady) return subscriber;
    if (!reader?.isReady) return null;
    if (!subscriberReady) {
        const next = reader.duplicate();
        next.on("error", (error) => console.error("[positionLive]", error.message));
        subscriber = next;
        subscriberReady = next.connect().then(() => next).catch((error) => {
            console.error("[positionLive]", error.message);
            subscriber = null;
            return null;
        });
    }
    return subscriberReady;
}

async function subscribe(account) {
    const feed = feedFor(account);
    if (feed.subscribed) return;
    feed.subscribed = true;
    const sub = await ensureSubscriber();
    if (!sub) {
        feed.subscribed = false;
        return;
    }
    await sub.subscribe(notifyChannel(account), (message) => {
        const notice = parseNotice(message);
        if (!notice || notice.account !== account) return;
        applyStored(account, notice).catch((error) => console.error("[positionLive]", error.message));
    });
    await sub.subscribe(EXCHANGE_CHANNEL + account, () => {
        const current = feeds.get(account);
        if (!current) return;
        readExchangeBook(account).then(async (book) => {
            if (!book) return;
            current.last = await withOrders(account, book);
            publish(current);
        }).catch((error) => console.error("[positionLive]", error.message));
    });
    await sub.subscribe(ORDER_CHANNEL + account, () => {
        const feed = feeds.get(account);
        if (!feed?.last) return;
        withOrders(account, feed.last).then((snap) => {
            feed.last = snap;
            publish(feed);
        }).catch((error) => console.error("[positionLive]", error.message));
    });
}

async function unsubscribe(account) {
    const feed = feeds.get(account);
    if (!feed?.subscribed || !subscriber?.isReady) return;
    feed.subscribed = false;
    try {
        await subscriber.unsubscribe(notifyChannel(account));
        await subscriber.unsubscribe(EXCHANGE_CHANNEL + account);
        await subscriber.unsubscribe(ORDER_CHANNEL + account);
    } catch (error) {
        console.error("[positionLive]", error.message);
    }
}

function startQuote(account, feed) {
    if (feed.quoteTimer) return;
    const tick = async () => {
        if (!feed.viewers.size) return;
        const exchange = await readExchangeBook(account);
        if (exchange) feed.last = await withOrders(account, exchange);
        else if (feed.last) feed.last = await withOrders(account, feed.last);
        publish(feed);
    };
    feed.quoteTimer = setInterval(() => tick().catch((error) => console.error("[positionLive]", error.message)), QUOTE_MS);
    feed.quoteTimer.unref?.();
}

function startExchangeRefresh(account, feed) {
    if (feed.exchangeTimer) return;
    const { loadExchangeBook } = require("./position-feed");
    feed.exchangeTimer = setInterval(() => {
        loadExchangeBook(account, { force: true })
            .then((book) => saveExchangeBook(account, book))
            .then(() => refresh(account))
            .then(() => publish(feed))
            .catch((error) => console.error("[positionLive]", error.message));
    }, EXCHANGE_REFRESH_MS);
    feed.exchangeTimer.unref?.();
}

async function refresh(account) {
    const feed = feedFor(account);
    const exchange = await readExchangeBook(account);
    if (exchange) {
        feed.last = await withOrders(account, exchange);
        return feed.last;
    }
    const cachedSnap = await readRedis(account);
    if (cachedSnap) {
        feed.last = await withOrders(account, cachedSnap);
        return feed.last;
    }
    return feed.last;
}

function watch(account, viewer) {
    const feed = feedFor(account);
    feed.viewers.add(viewer);
    subscribe(account).catch((error) => console.error("[positionLive]", error.message));
    refresh(account).then((snap) => {
        if (feed.viewers.has(viewer)) viewer(snap || feed.last);
        startQuote(account, feed);
        startExchangeRefresh(account, feed);
    }).catch((error) => console.error("[positionLive]", error.message));
    return function unwatch() {
        feed.viewers.delete(viewer);
        if (feed.viewers.size > 0) return;
        if (feed.polling) clearInterval(feed.polling);
        if (feed.quoteTimer) clearInterval(feed.quoteTimer);
        if (feed.exchangeTimer) clearInterval(feed.exchangeTimer);
        feed.polling = null;
        feed.quoteTimer = null;
        feed.exchangeTimer = null;
        unsubscribe(account).catch((error) => console.error("[positionLive]", error.message));
    };
}

function cached(account) {
    return feeds.get(account)?.last || null;
}

function bindRedis(client) {
    reader = client;
    subscriber = null;
    subscriberReady = null;
}

function resetLive() {
    for (const feed of feeds.values()) {
        if (feed.polling) clearInterval(feed.polling);
        if (feed.quoteTimer) clearInterval(feed.quoteTimer);
        if (feed.exchangeTimer) clearInterval(feed.exchangeTimer);
    }
    feeds.clear();
    reader = null;
    subscriber = null;
    subscriberReady = null;
}

module.exports = { watch, refresh, cached, readBooks, readExchangeBook, readExchangeBooks, saveExchangeBook, bindRedis, applyStored, resetLive, ORDER_KEY, ORDER_CHANNEL, EXCHANGE_KEY, EXCHANGE_CHANNEL };
