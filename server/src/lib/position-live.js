const { snapshotKey, notifyChannel, parseNotice, decorateSnapshot, decideUpdate } = require("./position-cache");
const { loadBinanceSnapshot } = require("./position-feed");

const ORDER_KEY = "wb:ord:";
const ORDER_CHANNEL = "wb:ord:notify:";
const QUOTE_MS = 15_000;

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
        await subscriber.unsubscribe(ORDER_CHANNEL + account);
    } catch (error) {
        console.error("[positionLive]", error.message);
    }
}

async function restFallback(account, feed) {
    if (Date.now() - feed.restAt < 15_000 && feed.last) return feed.last;
    feed.restAt = Date.now();
    try {
        const loaded = await loadBinanceSnapshot(account);
        feed.last = decorateSnapshot({
            version: feed.last?.version || 0,
            at: new Date().toISOString(),
            source: "rest",
            account,
            positions: loaded.positions,
            openOrders: loaded.openOrders,
            algoOrders: loaded.algoOrders,
            monitors: feed.last?.monitors || [],
        });
        feed.last.status = "polling";
        feed.last.stale = false;
    } catch (error) {
        console.error("[positionLive]", error.message);
        feed.last = { ...(feed.last || { positions: [], openOrders: [], algoOrders: [], monitors: [] }), stale: true, status: "stale", error: "Không lấy được snapshot" };
    }
    return feed.last;
}

function startQuote(account, feed) {
    if (feed.quoteTimer) return;
    const tick = async () => {
        if (!feed.viewers.size) return;
        const cached = await readRedis(account);
        if (cached) feed.last = await withOrders(account, cached);
        else if (feed.last) feed.last = await withOrders(account, feed.last);
        publish(feed);
    };
    feed.quoteTimer = setInterval(() => tick().catch((error) => console.error("[positionLive]", error.message)), QUOTE_MS);
}

function startRest(account, feed) {
    if (feed.polling) return;
    const tick = async () => {
        if (!feed.viewers.size) return;
        const cached = await readRedis(account);
        if (cached && !cached.stale) {
            feed.last = await withOrders(account, cached);
            publish(feed);
            return;
        }
        await restFallback(account, feed);
        publish(feed);
    };
    tick().catch((error) => console.error("[positionLive]", error.message));
    feed.polling = setInterval(() => tick().catch((error) => console.error("[positionLive]", error.message)), 15_000);
}

async function refresh(account) {
    const feed = feedFor(account);
    const cachedSnap = await readRedis(account);
    if (cachedSnap) {
        feed.last = await withOrders(account, cachedSnap);
        return feed.last;
    }
    if (feed.last?.stale === false && feed.last?.source === "rest") return feed.last;
    return restFallback(account, feed);
}

function watch(account, viewer) {
    const feed = feedFor(account);
    feed.viewers.add(viewer);
    subscribe(account).catch((error) => console.error("[positionLive]", error.message));
    refresh(account).then((snap) => {
        if (feed.viewers.has(viewer)) viewer(snap || feed.last);
        if (!snap || snap.stale || snap.source !== "monitor") startRest(account, feed);
        startQuote(account, feed);
    }).catch((error) => console.error("[positionLive]", error.message));
    return function unwatch() {
        feed.viewers.delete(viewer);
        if (feed.viewers.size > 0) return;
        if (feed.polling) clearInterval(feed.polling);
        if (feed.quoteTimer) clearInterval(feed.quoteTimer);
        feed.polling = null;
        feed.quoteTimer = null;
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
    }
    feeds.clear();
    reader = null;
    subscriber = null;
    subscriberReady = null;
}

module.exports = { watch, refresh, cached, readBooks, bindRedis, applyStored, resetLive, ORDER_KEY, ORDER_CHANNEL };
