const MARK_URL = "wss://fstream.binance.com/ws/!markPrice@arr@1s";

const marks = new Map();
let socket = null;
let reconnectTimer = null;
let stopped = false;

function num(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function ingestMarkPrices(payload, store = marks) {
    const rows = Array.isArray(payload) ? payload : [payload];
    for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        if (row.e && row.e !== "markPriceUpdate") continue;
        const symbol = String(row.s || "").toUpperCase();
        const price = num(row.p);
        if (!symbol || !price) continue;
        store.set(symbol, price);
    }
    return store;
}

function markOf(symbol) {
    return marks.get(String(symbol || "").toUpperCase()) || null;
}

function connectMarkSocket(deps = {}) {
    const connect = deps.connect;
    if (!connect) return null;
    const current = connect(deps.url || MARK_URL, {
        onMessage(payload) {
            try {
                ingestMarkPrices(payload);
            } catch (error) {
                console.error("[markPrices]", error.message);
            }
        },
        onError(error) {
            console.error("[markPrices]", error?.message || "websocket");
        },
        onClose() {
            socket = null;
            if (stopped || reconnectTimer) return;
            reconnectTimer = setTimeout(() => {
                reconnectTimer = null;
                socket = connectMarkSocket(deps);
            }, 2000);
        },
    });
    return current;
}

function defaultConnect(url, handlers) {
    const WebSocket = require("ws");
    const ws = new WebSocket(url);
    ws.on("open", () => console.log("[markPrices] subscribed"));
    ws.on("message", (data) => {
        try {
            handlers.onMessage(JSON.parse(String(data)));
        } catch (error) {
            console.error("[markPrices]", error.message);
        }
    });
    ws.on("close", () => handlers.onClose?.());
    ws.on("error", (error) => handlers.onError?.(error));
    return { close() { try { ws.close(); } catch (error) { console.error("[markPrices]", error.message); } } };
}

function startMarkPrices(deps = {}) {
    if (socket || stopped) return;
    stopped = false;
    socket = connectMarkSocket({ connect: deps.connect || defaultConnect, url: deps.url });
}

function stopMarkPrices() {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    socket?.close?.();
    socket = null;
    marks.clear();
}

module.exports = {
    MARK_URL,
    ingestMarkPrices,
    markOf,
    startMarkPrices,
    stopMarkPrices,
};
