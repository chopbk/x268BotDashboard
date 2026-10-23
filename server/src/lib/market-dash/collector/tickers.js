/**
 * Ticker snapshot: WS !ticker@arr ưu tiên, fallback REST 24hr.
 */
const WebSocket = require("ws");
const { config } = require("../config");
const { smartMoneyFetch } = require("../../smart-money/http");
const { finite } = require("../../smart-money/formulas");
const { saveTickers, getTickers } = require("../store");
const { getDashUniverse } = require("../universe");

const WS_URL = "wss://fstream.binance.com/ws/!ticker@arr";

/** @type {import('ws').WebSocket|null} */
let ws = null;
let wsDesired = false;
let lastWsAt = 0;
let reconnectTimer = null;

function applyTickerRow(map, t) {
    const symbol = t.s || t.symbol;
    if (!symbol) return;
    map.set(symbol, {
        symbol,
        lastPrice: finite(t.c ?? t.lastPrice),
        priceChangePercent: finite(t.P ?? t.priceChangePercent),
        quoteVolume: finite(t.q ?? t.quoteVolume),
        highPrice: finite(t.h ?? t.highPrice),
        lowPrice: finite(t.l ?? t.lowPrice),
        updatedAt: Date.now(),
    });
}

async function pollTickersRest() {
    const { body } = await smartMoneyFetch("fapi", "/fapi/v1/ticker/24hr");
    if (!Array.isArray(body)) throw new Error("ticker_24hr_invalid");
    const map = new Map();
    for (const t of body) applyTickerRow(map, t);
    await saveTickers(map);
    return map;
}

function connectWs() {
    if (!config.useWs || !wsDesired) return;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    try {
        ws = new WebSocket(WS_URL);
    } catch (error) {
        console.warn("[MARKET_DASH] ws connect", error.message || error);
        scheduleReconnect();
        return;
    }

    ws.on("open", () => {
        console.log("[MARKET_DASH] ticker WS open");
    });

    ws.on("message", async (raw) => {
        try {
            const data = JSON.parse(String(raw));
            if (!Array.isArray(data)) return;
            const prev = await getTickers();
            const map = new Map(prev);
            const universe = new Set(getDashUniverse().symbols);
            for (const t of data) {
                if (universe.size && !universe.has(t.s)) continue;
                applyTickerRow(map, t);
            }
            lastWsAt = Date.now();
            await saveTickers(map);
        } catch (error) {
            console.warn("[MARKET_DASH] ws message", error.message || error);
        }
    });

    ws.on("close", () => {
        console.warn("[MARKET_DASH] ticker WS close");
        ws = null;
        scheduleReconnect();
    });

    ws.on("error", (error) => {
        console.warn("[MARKET_DASH] ticker WS error", error.message || error);
    });
}

function scheduleReconnect() {
    if (!wsDesired || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectWs();
    }, 5_000);
}

function startTickerWs() {
    wsDesired = true;
    connectWs();
}

function stopTickerWs() {
    wsDesired = false;
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    if (ws) {
        try {
            ws.close();
        } catch {
            /* ignore */
        }
        ws = null;
    }
}

function tickerWsFresh(maxAgeMs = 10_000) {
    return lastWsAt > 0 && Date.now() - lastWsAt < maxAgeMs;
}

/**
 * Cập nhật tickers: REST nếu WS stale hoặc force.
 */
async function refreshTickers(opts = {}) {
    if (!opts.force && tickerWsFresh()) {
        return { source: "ws", size: (await getTickers()).size };
    }
    const map = await pollTickersRest();
    return { source: "rest", size: map.size };
}

module.exports = {
    startTickerWs,
    stopTickerWs,
    refreshTickers,
    pollTickersRest,
    tickerWsFresh,
};
