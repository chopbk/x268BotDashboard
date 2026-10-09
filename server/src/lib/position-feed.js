const { httpError } = require("./http");
const { createBinanceFutures } = require("./binance-futures");

const PRIVATE_EVENTS = "ACCOUNT_UPDATE,ORDER_TRADE_UPDATE,ALGO_UPDATE,listenKeyExpired";
const POLL_MS = 15 * 1000;
const GRACE_MS = 5 * 1000;
const KEEPALIVE_MS = 30 * 60 * 1000;
const BACKOFF = [1000, 2000, 5000, 10000];

function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function sideSign(row) {
    const mode = String(row.positionSide || "BOTH").toUpperCase();
    if (mode === "SHORT") return -1;
    if (mode === "LONG") return 1;
    return num(row.positionAmt) < 0 ? -1 : 1;
}

function applyMark(positions, symbol, mark) {
    const price = num(mark);
    if (!symbol || !price) return positions;
    return positions.map((row) => {
        if (String(row.symbol || "").toUpperCase() !== symbol) return row;
        const qty = Math.abs(num(row.positionAmt));
        const entry = num(row.entryPrice);
        const unrealized = qty && entry ? (price - entry) * qty * sideSign(row) : row.unRealizedProfit;
        return { ...row, markPrice: String(price), unRealizedProfit: unrealized };
    });
}

function applyAccountUpdate(positions, event) {
    const updates = event?.a?.P || [];
    const next = positions.map((row) => ({ ...row }));
    for (const item of updates) {
        const symbol = String(item.s || "").toUpperCase();
        const mode = String(item.ps || "BOTH").toUpperCase();
        const amount = num(item.pa);
        const index = next.findIndex((row) => String(row.symbol || "").toUpperCase() === symbol && String(row.positionSide || "BOTH").toUpperCase() === mode);
        if (Math.abs(amount) <= 1e-12) {
            if (index >= 0) next.splice(index, 1);
            continue;
        }
        const previous = index >= 0 ? next[index] : {};
        const patch = {
            ...previous,
            symbol,
            positionSide: mode,
            positionAmt: String(amount),
            entryPrice: item.ep ?? previous.entryPrice,
            unRealizedProfit: item.up ?? previous.unRealizedProfit,
            marginType: item.mt ?? previous.marginType,
        };
        if (index >= 0) next[index] = patch;
        else next.push(patch);
    }
    return next;
}

function applyOrderUpdate(orders, event) {
    const order = event?.o || {};
    const id = String(order.i || "");
    const status = String(order.X || "");
    const next = (orders || []).filter((row) => String(row.orderId) !== id);
    if (!id || ["FILLED", "CANCELED", "EXPIRED", "REJECTED"].includes(status)) return next;
    next.push({
        orderId: id,
        symbol: order.s,
        side: order.S,
        positionSide: order.ps,
        type: order.o,
        price: order.p,
        stopPrice: order.sp,
        origQty: order.q,
        executedQty: order.z,
        status,
        reduceOnly: order.R === true || order.R === "true",
    });
    return next;
}

function emptySnap() {
    return { positions: [], openOrders: [], algoOrders: [], at: null, status: "idle", stale: false, error: "" };
}

function createPositionHub(deps = {}) {
    const feeds = new Map();
    const loadSnapshot = deps.loadSnapshot;
    const openListenKey = deps.openListenKey;
    const connect = deps.connect;
    const pollMs = deps.pollMs || POLL_MS;
    const graceMs = deps.graceMs ?? GRACE_MS;
    const setTimer = deps.setTimer || setTimeout;
    const clearTimer = deps.clearTimer || clearTimeout;
    const now = deps.now || Date.now;

    function feedFor(account) {
        if (!feeds.has(account)) {
            feeds.set(account, {
                viewers: new Set(),
                snapshot: emptySnap(),
                generation: 0,
                user: null,
                mark: null,
                listen: null,
                stopTimer: null,
                pollTimer: null,
                retryTimer: null,
                keepTimer: null,
                attempt: 0,
                userOpen: false,
                starting: null,
            });
        }
        return feeds.get(account);
    }

    function publish(feed) {
        const snap = { ...feed.snapshot, positions: feed.snapshot.positions, openOrders: feed.snapshot.openOrders, algoOrders: feed.snapshot.algoOrders };
        for (const viewer of feed.viewers) {
            try {
                viewer(snap);
            } catch (error) {
                console.error("[positionFeed]", error.message);
            }
        }
    }

    function clearLoop(feed, name) {
        if (feed[name]) clearTimer(feed[name]);
        feed[name] = null;
    }

    async function takeSnapshot(account, feed, status) {
        try {
            const loaded = await loadSnapshot(account);
            feed.snapshot = {
                positions: Array.isArray(loaded?.positions) ? loaded.positions : feed.snapshot.positions,
                openOrders: Array.isArray(loaded?.openOrders) ? loaded.openOrders : feed.snapshot.openOrders,
                algoOrders: Array.isArray(loaded?.algoOrders) ? loaded.algoOrders : feed.snapshot.algoOrders,
                at: new Date(now()).toISOString(),
                status,
                stale: status === "stale",
                error: "",
            };
        } catch (error) {
            console.error("[positionFeed]", error.message);
            feed.snapshot = {
                ...feed.snapshot,
                at: feed.snapshot.at,
                status: "stale",
                stale: true,
                error: "Không lấy được snapshot",
            };
        }
        publish(feed);
    }

    function symbolsOf(feed) {
        return [...new Set(feed.snapshot.positions.map((row) => String(row.symbol || "").toLowerCase()).filter(Boolean))];
    }

    function connectMark(account, feed) {
        if (feed.mark) {
            feed.mark.close();
            feed.mark = null;
        }
        const symbols = symbolsOf(feed);
        if (!symbols.length || !connect) return;
        const url = `wss://fstream.binance.com/market/stream?streams=${symbols.map((symbol) => `${symbol}@markPrice@1s`).join("/")}`;
        const generation = feed.generation;
        feed.mark = connect(url, {
            onMessage(event) {
                if (generation !== feed.generation) return;
                const data = event?.data || event;
                if (data?.e !== "markPriceUpdate") return;
                feed.snapshot = {
                    ...feed.snapshot,
                    positions: applyMark(feed.snapshot.positions, String(data.s || "").toUpperCase(), data.p),
                    at: new Date(now()).toISOString(),
                };
                if (feed.markTimer) return;
                feed.markTimer = setTimer(() => {
                    feed.markTimer = null;
                    publish(feed);
                }, 500);
            },
            onError(error) {
                console.error("[positionFeed]", error?.message || "mark");
            },
        });
    }

    function scheduleRetry(account, feed) {
        if (feed.viewers.size === 0 || feed.retryTimer) return;
        const wait = BACKOFF[Math.min(feed.attempt, BACKOFF.length - 1)];
        feed.attempt += 1;
        feed.retryTimer = setTimer(() => {
            feed.retryTimer = null;
            startUser(account, feed);
        }, wait);
    }

    function startPoll(account, feed) {
        if (feed.pollTimer || feed.viewers.size === 0) return;
        feed.pollTimer = setTimer(async function tick() {
            feed.pollTimer = null;
            if (feed.userOpen || feed.viewers.size === 0) return;
            await takeSnapshot(account, feed, "polling");
            startPoll(account, feed);
        }, pollMs);
    }

    async function startUser(account, feed) {
        if (!openListenKey || !connect || feed.viewers.size === 0) return;
        feed.generation += 1;
        const generation = feed.generation;
        if (feed.user) feed.user.close();
        feed.user = null;
        feed.userOpen = false;
        await takeSnapshot(account, feed, "polling");
        if (generation !== feed.generation || feed.viewers.size === 0) return;
        try {
            if (feed.listen?.close) await feed.listen.close().catch((error) => console.error("[positionFeed]", error.message));
            feed.listen = await openListenKey(account);
            if (generation !== feed.generation || feed.viewers.size === 0) {
                await feed.listen?.close?.();
                return;
            }
            const url = `wss://fstream.binance.com/private/ws?listenKey=${encodeURIComponent(feed.listen.listenKey)}&events=${PRIVATE_EVENTS}`;
            feed.user = connect(url, {
                onOpen() {
                    if (generation !== feed.generation) return;
                    feed.userOpen = true;
                    clearLoop(feed, "pollTimer");
                    const retry = feed.attempt > 0 || feed.snapshot.stale;
                    feed.attempt = 0;
                    if (retry) takeSnapshot(account, feed, "live");
                    else {
                        feed.snapshot = { ...feed.snapshot, status: "live", stale: false, error: "" };
                        publish(feed);
                    }
                },
                onMessage(event) {
                    if (generation !== feed.generation) return;
                    const data = event?.data?.e ? event.data : event;
                    if (data?.e === "listenKeyExpired") {
                        feed.userOpen = false;
                        feed.snapshot = { ...feed.snapshot, status: "stale", stale: true, error: "listenKey hết hạn" };
                        publish(feed);
                        startPoll(account, feed);
                        scheduleRetry(account, feed);
                        return;
                    }
                    if (data?.e === "ACCOUNT_UPDATE") {
                        feed.snapshot = {
                            ...feed.snapshot,
                            positions: applyAccountUpdate(feed.snapshot.positions, data),
                            at: new Date(now()).toISOString(),
                            status: "live",
                            stale: false,
                        };
                        connectMark(account, feed);
                        publish(feed);
                        return;
                    }
                    if (data?.e === "ORDER_TRADE_UPDATE") {
                        feed.snapshot = {
                            ...feed.snapshot,
                            openOrders: applyOrderUpdate(feed.snapshot.openOrders, data),
                            at: new Date(now()).toISOString(),
                        };
                        publish(feed);
                        return;
                    }
                    if (data?.e === "ALGO_UPDATE") {
                        takeSnapshot(account, feed, feed.userOpen ? "live" : "polling");
                    }
                },
                onClose() {
                    if (generation !== feed.generation) return;
                    feed.userOpen = false;
                    feed.snapshot = { ...feed.snapshot, status: "stale", stale: true, error: "Mất kết nối sàn" };
                    publish(feed);
                    startPoll(account, feed);
                    scheduleRetry(account, feed);
                },
                onError(error) {
                    console.error("[positionFeed]", error?.message || "user");
                },
            });
            clearLoop(feed, "keepTimer");
            const keep = () => {
                feed.keepTimer = setTimer(() => {
                    feed.listen?.keep?.().catch((error) => console.error("[positionFeed]", error.message));
                    if (feed.viewers.size) keep();
                }, KEEPALIVE_MS);
            };
            keep();
            connectMark(account, feed);
        } catch (error) {
            console.error("[positionFeed]", error.message);
            feed.snapshot = { ...feed.snapshot, status: "stale", stale: true, error: "Không mở được stream sàn" };
            publish(feed);
            startPoll(account, feed);
            scheduleRetry(account, feed);
        }
    }

    function stop(account) {
        const feed = feeds.get(account);
        if (!feed || feed.viewers.size) return;
        feed.generation += 1;
        clearLoop(feed, "stopTimer");
        clearLoop(feed, "pollTimer");
        clearLoop(feed, "retryTimer");
        clearLoop(feed, "keepTimer");
        clearLoop(feed, "markTimer");
        feed.user?.close?.();
        feed.mark?.close?.();
        const listen = feed.listen;
        feed.user = null;
        feed.mark = null;
        feed.listen = null;
        feed.userOpen = false;
        feeds.delete(account);
        listen?.close?.().catch((error) => console.error("[positionFeed]", error.message));
    }

    function watch(account, viewer) {
        const feed = feedFor(account);
        if (feed.stopTimer) clearLoop(feed, "stopTimer");
        feed.viewers.add(viewer);
        if (feed.snapshot.at) viewer(feed.snapshot);
        if (!feed.snapshot.at && !feed.starting) {
            feed.starting = takeSnapshot(account, feed, "snapshot").finally(() => { feed.starting = null; });
        }
        return function unwatch() {
            feed.viewers.delete(viewer);
            if (feed.viewers.size > 0 || feed.stopTimer) return;
            feed.stopTimer = setTimer(() => stop(account), graceMs);
        };
    }

    function cached(account) {
        const feed = feeds.get(account);
        if (!feed || feed.snapshot.status === "idle") return null;
        return feed.snapshot;
    }

    async function prime(account) {
        const feed = feedFor(account);
        if (feed.snapshot.at && !feed.snapshot.stale) return feed.snapshot;
        if (!feed.starting) feed.starting = takeSnapshot(account, feed, "snapshot").finally(() => { feed.starting = null; });
        await feed.starting;
        return feed.snapshot;
    }

    async function stopAll() {
        for (const account of [...feeds.keys()]) {
            const feed = feeds.get(account);
            if (feed) feed.viewers.clear();
            stop(account);
        }
    }

    return { watch, cached, prime, stopAll, applyAccountUpdate, applyOrderUpdate, applyMark };
}

function exactName(username) {
    return new RegExp(`^${String(username).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
}

async function binanceClient(account) {
    const UserApi = require("../models/user-api");
    const api = await UserApi.findOne({ username: exactName(account) }).select("username exchange api_key api_secret").lean();
    if (!api?.api_key || !api?.api_secret) throw httpError(400, "User chưa có API key");
    if (String(api.exchange || "binance").toLowerCase() !== "binance") throw httpError(400, "Chỉ hỗ trợ Binance futures");
    return createBinanceFutures({ apiKey: api.api_key, apiSecret: api.api_secret });
}

const exchangeCache = new Map();
const EXCHANGE_CACHE_MS = 15 * 60 * 1000;

async function loadExchangeBook(account, deps = {}) {
    const now = typeof deps.now === "function" ? deps.now() : Date.now();
    if (deps.force) exchangeCache.delete(account);
    const hit = exchangeCache.get(account);
    if (hit && now - hit.at < EXCHANGE_CACHE_MS) {
        if (hit.error) throw hit.error;
        return hit.book;
    }
    try {
        const load = deps.load || loadBinanceSnapshot;
        const loaded = await load(account);
        const book = {
            source: "rest",
            status: "polling",
            stale: false,
            at: new Date(now).toISOString(),
            positions: Array.isArray(loaded?.positions) ? loaded.positions : [],
            openOrders: Array.isArray(loaded?.openOrders) ? loaded.openOrders : [],
            algoOrders: Array.isArray(loaded?.algoOrders) ? loaded.algoOrders : [],
        };
        exchangeCache.set(account, { at: now, book });
        return book;
    } catch (error) {
        exchangeCache.set(account, { at: now, error });
        throw error;
    }
}

function resetExchangeCache() {
    exchangeCache.clear();
}

async function loadBinanceSnapshot(account) {
    const client = await binanceClient(account);
    const [positions, openOrders, algoRaw] = await Promise.all([
        client.signedGet("/fapi/v2/positionRisk"),
        client.signedGet("/fapi/v1/openOrders"),
        client.signedGet("/fapi/v1/openAlgoOrders").catch((error) => {
            console.error("[loadBinanceSnapshot]", error.message);
            return [];
        }),
    ]);
    return {
        positions: (Array.isArray(positions) ? positions : []).filter((row) => Math.abs(num(row.positionAmt)) > 0),
        openOrders: Array.isArray(openOrders) ? openOrders : [],
        algoOrders: Array.isArray(algoRaw) ? algoRaw : (algoRaw?.orders || []),
    };
}

async function openBinanceListenKey(account) {
    const client = await binanceClient(account);
    const opened = await client.signed("POST", "/fapi/v1/listenKey", {});
    const listenKey = opened?.listenKey;
    if (!listenKey) throw httpError(502, "Sàn không trả listenKey");
    return {
        listenKey,
        keep: () => client.signed("PUT", "/fapi/v1/listenKey", {}),
        close: () => client.signed("DELETE", "/fapi/v1/listenKey", { listenKey }),
    };
}

function connectWebSocket(url, handlers) {
    if (typeof WebSocket !== "function") {
        handlers.onError?.(new Error("WebSocket không có sẵn"));
        handlers.onClose?.();
        return { close() {} };
    }
    const ws = new WebSocket(url);
    ws.addEventListener("open", () => handlers.onOpen?.());
    ws.addEventListener("message", (event) => {
        try {
            handlers.onMessage?.(JSON.parse(String(event.data)));
        } catch (error) {
            console.error("[positionFeed]", error.message);
        }
    });
    ws.addEventListener("close", () => handlers.onClose?.());
    ws.addEventListener("error", () => handlers.onError?.(new Error("websocket")));
    return { close() { try { ws.close(); } catch (error) { console.error("[positionFeed]", error.message); } } };
}

let hub = null;

function getPositionHub() {
    if (!hub) {
        hub = createPositionHub({
            loadSnapshot: loadBinanceSnapshot,
            openListenKey: openBinanceListenKey,
            connect: connectWebSocket,
        });
    }
    return hub;
}

module.exports = {
    createPositionHub,
    getPositionHub,
    loadBinanceSnapshot,
    loadExchangeBook,
    resetExchangeCache,
    applyAccountUpdate,
    applyOrderUpdate,
    applyMark,
    PRIVATE_EVENTS,
};
