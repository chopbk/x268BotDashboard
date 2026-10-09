const MARK_URL = "wss://fstream.binance.com/market/ws/!markPrice@arr@1s";
const PREMIUM_URL = "https://fapi.binance.com/fapi/v1/premiumIndex";

const marks = new Map();
let socket = null;
let reconnectTimer = null;
let stopped = false;

function num(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function ingestMarkPrices(payload, store = marks) {
    const body = payload?.data && !payload.s ? payload.data : payload;
    const rows = Array.isArray(body) ? body : [body];
    for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        if (row.e && row.e !== "markPriceUpdate") continue;
        const symbol = String(row.s || row.symbol || "").toUpperCase();
        const price = num(row.p ?? row.markPrice);
        if (!symbol || !price) continue;
        store.set(symbol, price);
    }
    return store;
}

async function seedMarkPrices(deps = {}) {
    const load = deps.fetch || fetch;
    try {
        const response = await load(deps.premiumUrl || PREMIUM_URL, { signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error(`premiumIndex ${response.status}`);
        ingestMarkPrices(await response.json());
        console.log(`[markPrices] seed ${marks.size}`);
    } catch (error) {
        console.error("[markPrices]", error.message);
    }
}

function markOf(symbol) {
    return marks.get(String(symbol || "").toUpperCase()) || null;
}

function connectMarkSocket(deps = {}) {
    const connect = deps.connect;
    if (!connect) return null;
    let heard = false;
    let current = null;
    const quiet = setTimeout(() => {
        if (heard || stopped) return;
        console.error("[markPrices] không nhận giá, nối lại");
        current?.close?.();
    }, 8000);
    current = connect(deps.url || MARK_URL, {
        onMessage(payload) {
            heard = true;
            clearTimeout(quiet);
            try {
                const before = marks.size;
                ingestMarkPrices(payload);
                if (!before && marks.size) console.log(`[markPrices] live ${marks.size}`);
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

async function startMarkPrices(deps = {}) {
    if (socket || stopped) return;
    stopped = false;
    if (!deps.connect) await seedMarkPrices(deps);
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
    PREMIUM_URL,
    ingestMarkPrices,
    seedMarkPrices,
    markOf,
    startMarkPrices,
    stopMarkPrices,
};
