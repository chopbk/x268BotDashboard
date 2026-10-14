const { snapshotKey, notifyChannel, parseNotice, decorateSnapshot, decideUpdate } = require("./position-cache");

const ORDER_KEY = "wb:ord:";
const ORDER_CHANNEL = "wb:ord:notify:";
const EXCHANGE_KEY = "wb:ex:";
const EXCHANGE_CHANNEL = "wb:ex:notify:";
const EXCHANGE_TTL_SEC = 20 * 60;
const REDIS_POLL_MS = 30_000;     // 30s đọc Redis (positions, orders)
const MARK_PRICE_MS = 15_000;     // 15s cập nhật giá/PnL
const EXCHANGE_REFRESH_MS = 5 * 60 * 1000; // 5 phút refresh từ Binance API (chỉ khi user bấm hoặc background)
const EXCHANGE_WRITE = require("fs").readFileSync(require("path").join(__dirname, "exchange-book.lua"), "utf8");
const pendingRefresh = new Map();
const localBooks = new Map();
const accountErrors = new Map(); // Cache error per account to avoid spam
const ERROR_CACHE_MS = 60_000; // 1 phút không retry khi lỗi API key
let cooldownUntil = 0;

function touchBook(account) {
    if (!reader?.isReady || !account || typeof reader.expire !== "function") return;
    reader.expire(EXCHANGE_KEY + account, EXCHANGE_TTL_SEC).catch((error) => console.error("[positionLive]", error.message));
}

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

async function accountExchangeOf(account) {
    try {
        const { resolveAccountExchange } = require("./exchanges");
        return await resolveAccountExchange(account);
    } catch (error) {
        console.error("[positionLive]", error.message);
        return "unknown";
    }
}

async function readExchangeBook(account) {
    if (!account) return null;
    if (!reader?.isReady) {
        const local = localBooks.get(account) || null;
        return local ? migrateBook(local, account) : null;
    }
    try {
        const raw = await reader.get(EXCHANGE_KEY + account);
        if (!raw) return null;
        const book = JSON.parse(raw);
        const migrated = await migrateBook(book, account);
        if (!migrated) return null;
        touchBook(account);
        return migrated;
    } catch (error) {
        console.error("[positionLive]", error.message);
        return null;
    }
}

async function migrateBook(book, account) {
    if (!book || book.source !== "exchange" || !Array.isArray(book.positions)) return null;
    const { migrateExchangeBook } = require("./exchanges");
    // Chỉ resolve UserApi khi snapshot thiếu exchange — tránh Mongo gọi mỗi Redis read.
    let accountExchange = null;
    if (!book.exchange) {
        accountExchange = await accountExchangeOf(account);
    }
    const result = migrateExchangeBook(book, { accountExchange });
    if (!result.ok) {
        if (result.needsReconcile) {
            console.warn("[positionLive]", account, "stale book:", result.reason);
        }
        return null;
    }
    return result.book;
}

async function readExchangeBooks(names) {
    if (!names?.length) return {};
    if (!reader?.isReady) {
        const out = {};
        for (const name of names) {
            if (!localBooks.has(name)) continue;
            const migrated = await migrateBook(localBooks.get(name), name);
            if (migrated) out[name] = migrated;
        }
        return out;
    }
    try {
        const values = await reader.mGet(names.map((name) => EXCHANGE_KEY + name));
        const out = {};
        for (let index = 0; index < names.length; index += 1) {
            if (!values[index]) continue;
            try {
                const book = JSON.parse(values[index]);
                const migrated = await migrateBook(book, names[index]);
                if (migrated) {
                    out[names[index]] = migrated;
                    touchBook(names[index]);
                }
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

async function saveExchangeBook(account, book, expectedVersion) {
    if (!reader?.isReady || !account || !book || expectedVersion == null) return null;
    const nowMs = Date.now();
    const at = book.at || new Date(nowMs).toISOString();
    const raw = await reader.eval(EXCHANGE_WRITE, {
        keys: [EXCHANGE_KEY + account, EXCHANGE_KEY + account + ":ver", EXCHANGE_CHANNEL + account],
        arguments: ["full", JSON.stringify(book), String(expectedVersion), at, account, String(nowMs)],
    });
    return raw ? JSON.parse(raw) : null;
}

async function reconcileViaMqtt(account, current) {
    const { requestPositionRefresh } = require("./data-refresh");
    const result = await requestPositionRefresh(account);
    if (result.status !== "succeeded") {
        throw new Error(result.error || "MQTT refresh failed");
    }
    // binance-bot đã ghi vào Redis, đọc lại
    const refreshed = await readExchangeBook(account);
    return refreshed || current;
}

async function loadFromBinance(account, current, { details = false } = {}) {
    const cachedError = accountErrors.get(account);
    if (cachedError && Date.now() < cachedError.until) {
        console.warn("[positionReconcile]", account, "skipping exchange REST (cached error):", cachedError.message);
        return current;
    }
    const expected = reader?.isReady ? Number(await reader.get(EXCHANGE_KEY + account + ":ver")) || 0 : null;
    // Dùng exports object để test có thể mock loadBinanceSnapshot.
    const feed = require("./position-feed");
    const loaded = await feed.loadBinanceSnapshot(account, { liveOnly: true });
    accountErrors.delete(account);
    let income = current?.income || [];
    let positionHistory = current?.positionHistory || [];
    let trades = current?.trades || [];
    if (details) {
        try {
            const hist = await feed.loadBinanceHistoryDetails(account, {
                positions: loaded.positions || [],
            });
            income = hist.income || [];
            positionHistory = hist.positionHistory || [];
            trades = hist.trades || [];
        } catch (error) {
            console.error("[loadFromExchange] history", account, error.message);
        }
    }
    const conditional = Array.isArray(loaded.conditionalOrders)
        ? loaded.conditionalOrders
        : Array.isArray(loaded.algoOrders) ? loaded.algoOrders : [];
    const at = new Date().toISOString();
    const book = {
        ...(current || {}),
        ...loaded,
        income,
        positionHistory,
        trades,
        source: "exchange",
        account,
        exchange: loaded.exchange,
        exchangeDisplay: loaded.exchangeDisplay,
        conditionalOrders: conditional,
        algoOrders: conditional,
        status: "live",
        complete: true,
        stale: false,
        at,
        reconciledAt: at,
    };
    if (reader?.isReady) return await saveExchangeBook(account, book, expected) || current;
    const stored = { ...book, version: null };
    localBooks.set(account, stored);
    return stored;
}

async function reconcile(account, { force = false, maxAgeMs = EXCHANGE_REFRESH_MS, details = false, viaMqtt = true } = {}) {
    if (pendingRefresh.has(account)) return pendingRefresh.get(account);
    const job = (async () => {
        let token = null;
        const lock = `${EXCHANGE_KEY}${account}:refresh`;
        try {
            let current = await readExchangeBook(account);
            const checked = new Date(current?.reconciledAt || current?.at || 0).getTime();
            if (!force && current?.complete !== false && current && Date.now() - checked < maxAgeMs) return current;
            if (Date.now() < cooldownUntil || (reader?.isReady && await reader.get("wb:ex:cooldown"))) {
                // Đang cooldown, thử MQTT (binance-bot có API key riêng)
                if (viaMqtt) {
                    try {
                        console.log("[positionReconcile]", account, "cooldown active, trying MQTT");
                        return await reconcileViaMqtt(account, current);
                    } catch (mqttError) {
                        console.warn("[positionReconcile]", account, "MQTT fallback failed:", mqttError.message);
                    }
                }
                return current;
            }
            if (reader?.isReady) {
                token = require("crypto").randomUUID();
                if (!await reader.set(lock, token, { NX: true, PX: 120_000 })) return current;
                // Another instance may have completed between our first read and acquiring the lease.
                current = await readExchangeBook(account);
                const refreshedAt = new Date(current?.reconciledAt || current?.at || 0).getTime();
                if (!force && current && current.complete !== false && Date.now() - refreshedAt < maxAgeMs) return current;
            }

            // Ưu tiên MQTT nếu có kết nối (binance-bot gọi Binance, tránh rate limit)
            if (viaMqtt) {
                const { isConnected } = require("./bot-mqtt");
                if (isConnected()) {
                    try {
                        console.log("[positionReconcile]", account, "using MQTT");
                        return await reconcileViaMqtt(account, current);
                    } catch (mqttError) {
                        // MQTT fail (timeout / chưa có handler) → fallback Binance để vẫn thấy position no-monitor
                        console.warn("[positionReconcile]", account, "MQTT failed, falling back to Binance:", mqttError.message);
                    }
                }
            }

            return await loadFromBinance(account, current, { details });
        } catch (error) {
            console.error("[positionReconcile]", account, error.message);
            // Rate limit 429: global cooldown
            if (error.status === 429) {
                const delay = Math.max(120_000, error.retryAfterMs || 0);
                cooldownUntil = Date.now() + delay;
                if (reader?.isReady) await reader.set("wb:ex:cooldown", "1", { PX: delay }).catch(() => {});
                token = null;
            }
            // API key lỗi hoặc lỗi khác: cache per-account để không retry liên tục
            if (error.message?.includes("API key") || error.message?.includes("Invalid") || error.message?.includes("permission")) {
                accountErrors.set(account, { message: error.message, until: Date.now() + ERROR_CACHE_MS });
            }
            throw error;
        } finally {
            if (token && reader?.isReady) {
                await reader.eval("if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0", {
                    keys: [lock], arguments: [token],
                }).catch((error) => console.error("[positionReconcile]", error.message));
            }
        }
    })();
    pendingRefresh.set(account, job);
    try { return await job; } finally { pendingRefresh.delete(account); }
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
        next.on("ready", () => {
            for (const [account, feed] of feeds) {
                if (feed.viewers.size) reconcile(account, { maxAgeMs: 5_000 })
                    .then(() => refresh(account)).then(() => publish(feed))
                    .catch((error) => console.error("[positionLive]", error.message));
            }
        });
        next.on("error", (error) => console.error("[positionLive]", error.message));
        subscriber = next;
        subscriberReady = next.connect().then(() => next).catch((error) => {
            console.error("[positionLive]", error.message);
            subscriber = null;
            subscriberReady = null;
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
    if (!feed.viewers.size) await unsubscribe(account);
}

async function unsubscribe(account) {
    const feed = feeds.get(account);
    if (!feed?.subscribed || !subscriber?.isReady) return;
    feed.subscribed = false;
    try {
        await subscriber.unsubscribe(notifyChannel(account));
        await subscriber.unsubscribe(EXCHANGE_CHANNEL + account);
        await subscriber.unsubscribe(ORDER_CHANNEL + account);
        if (feed.viewers.size) {
            feed.subscribed = false;
            await subscribe(account);
        }
    } catch (error) {
        console.error("[positionLive]", error.message);
    }
}

function startQuote(account, feed) {
    if (feed.quoteTimer) return;
    // 15s cập nhật giá/PnL từ Redis (binance-bot đã sync từ WebSocket)
    const tickMark = async () => {
        if (!feed.viewers.size) return;
        if (!feed.subscribed) await subscribe(account);
        // Chỉ publish lại với mark prices mới (feed.last đã có)
        if (feed.last) publish(feed);
    };
    feed.quoteTimer = setInterval(() => tickMark().catch((error) => console.error("[positionLive]", error.message)), MARK_PRICE_MS);
    feed.quoteTimer.unref?.();
    
    // 30s đọc Redis để lấy positions/orders mới
    if (feed.redisTimer) return;
    const tickRedis = async () => {
        if (!feed.viewers.size) return;
        const exchange = await readExchangeBook(account);
        if (exchange) feed.last = await withOrders(account, exchange);
        publish(feed);
    };
    feed.redisTimer = setInterval(() => tickRedis().catch((error) => console.error("[positionLive]", error.message)), REDIS_POLL_MS);
    feed.redisTimer.unref?.();
}

function startExchangeRefresh(account, feed) {
    if (feed.exchangeTimer) return;
    feed.exchangeTimer = setInterval(() => {
        if (!feed.viewers.size) return;
        reconcile(account).then(() => refresh(account)).then(() => publish(feed))
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

/**
 * Đối chiếu live (positions/orders/algo) — không kéo income/fills.
 * Dùng nền khi mở trang / WS watch.
 */
function reconcileLive(account, opts = {}) {
    return reconcile(account, {
        force: false,
        details: false,
        maxAgeMs: 30_000,
        viaMqtt: true,
        ...opts,
    });
}

function watch(account, viewer) {
    const feed = feedFor(account);
    feed.viewers.add(viewer);
    subscribe(account).catch((error) => console.error("[positionLive]", error.message));
    refresh(account).then((snap) => {
        if (feed.viewers.has(viewer)) viewer(snap || feed.last);
        if (!feed.viewers.size) return;
        startQuote(account, feed);
        startExchangeRefresh(account, feed);
        // Nền: live reconcile → ghi Redis → notify → WS patch (không block paint đầu).
        reconcileLive(account)
            .then(() => refresh(account))
            .then(() => {
                if (feed.viewers.size) publish(feed);
            })
            .catch((error) => console.error("[positionLive] reconcileLive", account, error.message));
    }).catch((error) => console.error("[positionLive]", error.message));
    return function unwatch() {
        feed.viewers.delete(viewer);
        if (feed.viewers.size > 0) return;
        if (feed.polling) clearInterval(feed.polling);
        if (feed.quoteTimer) clearInterval(feed.quoteTimer);
        if (feed.redisTimer) clearInterval(feed.redisTimer);
        if (feed.exchangeTimer) clearInterval(feed.exchangeTimer);
        feed.polling = null;
        feed.quoteTimer = null;
        feed.redisTimer = null;
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
        if (feed.redisTimer) clearInterval(feed.redisTimer);
        if (feed.exchangeTimer) clearInterval(feed.exchangeTimer);
    }
    feeds.clear();
    localBooks.clear();
    cooldownUntil = 0;
    reader = null;
    subscriber = null;
    subscriberReady = null;
}

module.exports = {
    reconcile,
    reconcileLive,
    watch,
    refresh,
    cached,
    readBooks,
    readExchangeBook,
    readExchangeBooks,
    saveExchangeBook,
    bindRedis,
    applyStored,
    resetLive,
    ORDER_KEY,
    ORDER_CHANNEL,
    EXCHANGE_KEY,
    EXCHANGE_CHANNEL,
};
