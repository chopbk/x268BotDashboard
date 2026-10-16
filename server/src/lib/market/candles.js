/**
 * Nến Futures USDT — fetch qua limiter Smart Money, chỉ dùng nến đóng để score.
 */
const { smartMoneyFetch } = require("../smart-money/http");
const { INTERVAL_MS, config } = require("./config");
const { getRedisClient } = require("../rate-limit-store");

const memory = new Map();
const MEM_TTL_MS = 10 * 60_000;

function parseKlines(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const row of raw) {
        const openTime = Number(row[0]);
        const open = Number(row[1]);
        const high = Number(row[2]);
        const low = Number(row[3]);
        const close = Number(row[4]);
        const volume = Number(row[5]);
        const closeTime = Number(row[6]);
        if (![openTime, open, high, low, close, volume, closeTime].every(Number.isFinite)) continue;
        if (!(high >= low) || !(high >= open && high >= close) || !(low <= open && low <= close)) continue;
        out.push({ openTime, open, high, low, close, volume, closeTime });
    }
    out.sort((a, b) => a.openTime - b.openTime);
    const deduped = [];
    for (const c of out) {
        if (deduped.length && deduped[deduped.length - 1].openTime === c.openTime) {
            deduped[deduped.length - 1] = c;
        } else deduped.push(c);
    }
    return deduped;
}

function splitClosed(candles, timeframe, now = Date.now()) {
    if (!candles.length) return { closed: [], forming: null };
    const last = candles[candles.length - 1];
    // Binance closeTime = ms cuối của nến; nến đóng khi now > closeTime
    const isForming = now <= last.closeTime;
    if (isForming) {
        return { closed: candles.slice(0, -1), forming: last };
    }
    return { closed: candles, forming: null };
}

function cacheKey(symbol, timeframe) {
    return `wb:mkt:kl:${String(symbol).toUpperCase()}:${timeframe}`;
}

async function readCache(symbol, timeframe) {
    const key = `${symbol}|${timeframe}`;
    const hit = memory.get(key);
    if (hit && Date.now() - hit.at < MEM_TTL_MS) return hit.candles;
    const client = getRedisClient();
    if (!client?.isReady) return null;
    try {
        const raw = await client.get(cacheKey(symbol, timeframe));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed?.candles)) return null;
        memory.set(key, { at: Date.now(), candles: parsed.candles });
        return parsed.candles;
    } catch {
        return null;
    }
}

async function writeCache(symbol, timeframe, candles) {
    const key = `${symbol}|${timeframe}`;
    memory.set(key, { at: Date.now(), candles });
    const client = getRedisClient();
    if (!client?.isReady) return;
    try {
        await client.set(
            cacheKey(symbol, timeframe),
            JSON.stringify({ at: Date.now(), candles }),
            { EX: 6 * 60 * 60 }
        );
    } catch (error) {
        console.warn("[marketCandles] redis set", error.message || error);
    }
}

/**
 * @param {string} symbol
 * @param {string} timeframe
 * @param {{ force?: boolean, fetchImpl?: Function, limit?: number }} opts
 */
async function fetchCandles(symbol, timeframe, opts = {}) {
    const sym = String(symbol || "").trim().toUpperCase();
    const limit = opts.limit || config.candleLimit;
    if (!opts.force) {
        const cached = await readCache(sym, timeframe);
        if (cached?.length) return cached;
    }

    if (opts.fetchImpl) {
        const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${encodeURIComponent(sym)}&interval=${encodeURIComponent(timeframe)}&limit=${limit}`;
        const res = await opts.fetchImpl(url);
        const body = await res.json();
        const candles = parseKlines(body);
        await writeCache(sym, timeframe, candles);
        return candles;
    }

    const { body } = await smartMoneyFetch(
        "fapi",
        `/fapi/v1/klines?symbol=${encodeURIComponent(sym)}&interval=${encodeURIComponent(timeframe)}&limit=${limit}`
    );
    const candles = parseKlines(body);
    await writeCache(sym, timeframe, candles);
    return candles;
}

/**
 * Lấy nến đóng sẵn sàng để score.
 */
async function loadClosedCandles(symbol, timeframe, opts = {}) {
    const candles = await fetchCandles(symbol, timeframe, opts);
    const now = opts.now || Date.now();
    const { closed, forming } = splitClosed(candles, timeframe, now);
    return {
        candles,
        closed,
        forming,
        formingCandle: Boolean(forming),
        closedBars: closed.length,
    };
}

function resetCandleCacheForTests() {
    memory.clear();
}

module.exports = {
    parseKlines,
    splitClosed,
    fetchCandles,
    loadClosedCandles,
    resetCandleCacheForTests,
};
