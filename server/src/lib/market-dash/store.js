/**
 * Redis snapshot + Mongo hist cho Market Dashboard.
 */
const { getRedisClient } = require("../rate-limit-store");
const MarketDashFundingHist = require("../../models/market-dash-funding-hist");
const MarketDashOiHist = require("../../models/market-dash-oi-hist");
const MarketDashCollectorState = require("../../models/market-dash-collector-state");

const SNAP_TTL_SEC = 6 * 60 * 60;
const memory = {
    overview: null,
    tickers: new Map(),
    symbols: new Map(),
    pulse: null,
    derivatives: null,
    heatmap: null,
    macro: null,
};

function key(part) {
    return `wb:mdash:${part}`;
}

async function redisSet(part, value, ttl = SNAP_TTL_SEC) {
    const client = getRedisClient();
    if (!client?.isReady) return;
    try {
        await client.set(key(part), JSON.stringify(value), { EX: ttl });
    } catch (error) {
        console.warn("[MARKET_DASH] redis set", error.message || error);
    }
}

async function redisGet(part) {
    const client = getRedisClient();
    if (!client?.isReady) return null;
    try {
        const raw = await client.get(key(part));
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        console.warn("[MARKET_DASH] redis get", error.message || error);
        return null;
    }
}

async function saveOverview(snapshot) {
    memory.overview = snapshot;
    await redisSet("overview", snapshot, 120);
}

async function getOverview() {
    if (memory.overview) return memory.overview;
    const cached = await redisGet("overview");
    if (cached) memory.overview = cached;
    return cached;
}

async function saveMacro(macro) {
    memory.macro = macro;
    await redisSet("macro", macro, 600);
}

async function getMacro() {
    if (memory.macro) return memory.macro;
    const cached = await redisGet("macro");
    if (cached) memory.macro = cached;
    return cached;
}

async function saveTickers(mapOrObj) {
    const obj =
        mapOrObj instanceof Map
            ? Object.fromEntries(mapOrObj)
            : mapOrObj;
    memory.tickers = new Map(Object.entries(obj));
    await redisSet("tickers", obj, 30);
}

async function getTickers() {
    if (memory.tickers.size) return memory.tickers;
    const cached = await redisGet("tickers");
    if (cached && typeof cached === "object") {
        memory.tickers = new Map(Object.entries(cached));
        return memory.tickers;
    }
    return memory.tickers;
}

async function saveSymbolSnap(symbol, snap) {
    const sym = String(symbol).toUpperCase();
    memory.symbols.set(sym, snap);
    await redisSet(`sym:${sym}`, snap, SNAP_TTL_SEC);
}

async function getSymbolSnap(symbol) {
    const sym = String(symbol || "").toUpperCase();
    if (!sym) return null;
    if (memory.symbols.has(sym)) return memory.symbols.get(sym);
    const cached = await redisGet(`sym:${sym}`);
    if (cached) {
        memory.symbols.set(sym, cached);
        return cached;
    }
    return null;
}

async function listSymbolSnaps(symbols) {
    const out = [];
    for (const s of symbols) {
        const snap = await getSymbolSnap(s);
        if (snap) out.push(snap);
    }
    return out;
}

async function savePulse(pulse) {
    memory.pulse = pulse;
    await redisSet("pulse", pulse, 300);
}

async function getPulse() {
    if (memory.pulse) return memory.pulse;
    const cached = await redisGet("pulse");
    if (cached) memory.pulse = cached;
    return cached;
}

async function saveDerivatives(deriv) {
    memory.derivatives = deriv;
    await redisSet("derivatives", deriv, 120);
}

async function getDerivatives() {
    if (memory.derivatives) return memory.derivatives;
    const cached = await redisGet("derivatives");
    if (cached) memory.derivatives = cached;
    return cached;
}

async function saveHeatmap(heatmap) {
    memory.heatmap = heatmap;
    await redisSet("heatmap", heatmap, 60);
}

async function getHeatmap() {
    if (memory.heatmap) return memory.heatmap;
    const cached = await redisGet("heatmap");
    if (cached) memory.heatmap = cached;
    return cached;
}

async function appendFundingHist(symbol, ts, rate, markPrice = null) {
    const sym = String(symbol).toUpperCase();
    const at = ts instanceof Date ? ts : new Date(ts);
    try {
        await MarketDashFundingHist.updateOne(
            { symbol: sym, ts: at },
            { $set: { symbol: sym, ts: at, rate, markPrice } },
            { upsert: true }
        );
    } catch (error) {
        if (error?.code !== 11000) {
            console.warn("[MARKET_DASH] funding hist", error.message || error);
        }
    }
}

async function appendOiHist(symbol, ts, qty, notional, period = "5m") {
    const sym = String(symbol).toUpperCase();
    const at = ts instanceof Date ? ts : new Date(ts);
    try {
        await MarketDashOiHist.updateOne(
            { symbol: sym, ts: at, period },
            { $set: { symbol: sym, ts: at, qty, notional, period } },
            { upsert: true }
        );
    } catch (error) {
        if (error?.code !== 11000) {
            console.warn("[MARKET_DASH] oi hist", error.message || error);
        }
    }
}

async function loadFundingRates(symbol, sinceMs) {
    const sym = String(symbol).toUpperCase();
    const since = new Date(sinceMs);
    try {
        return await MarketDashFundingHist.find({ symbol: sym, ts: { $gte: since } })
            .sort({ ts: 1 })
            .select("ts rate")
            .lean();
    } catch (error) {
        console.warn("[MARKET_DASH] load funding", error.message || error);
        return [];
    }
}

async function loadOiSeries(symbol, sinceMs, period = "5m") {
    const sym = String(symbol).toUpperCase();
    const since = new Date(sinceMs);
    try {
        return await MarketDashOiHist.find({ symbol: sym, period, ts: { $gte: since } })
            .sort({ ts: 1 })
            .select("ts qty notional")
            .lean();
    } catch (error) {
        console.warn("[MARKET_DASH] load oi", error.message || error);
        return [];
    }
}

function percentileOf(values, current) {
    if (current == null || !values?.length) return null;
    const sorted = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    if (!sorted.length) return null;
    let below = 0;
    for (const v of sorted) {
        if (v <= current) below += 1;
        else break;
    }
    return Math.round((below / sorted.length) * 1000) / 10;
}

async function fundingPercentile(symbol, currentRate, days = 90) {
    if (currentRate == null) return { percentile: null, samples: 0, baselineReady: false };
    const rows = await loadFundingRates(symbol, Date.now() - days * 24 * 60 * 60_000);
    const rates = rows.map((r) => r.rate).filter(Number.isFinite);
    return {
        percentile: percentileOf(rates, currentRate),
        samples: rates.length,
        baselineReady: rates.length >= 200,
    };
}

async function saveCollectorMeta(metrics) {
    try {
        await MarketDashCollectorState.updateOne(
            { _id: "mdash-main" },
            { $set: { metrics, updatedAt: new Date() } },
            { upsert: true }
        );
    } catch (error) {
        console.warn("[MARKET_DASH] collector meta", error.message || error);
    }
    await redisSet("meta", metrics, 24 * 60 * 60);
}

function resetStoreForTests() {
    memory.overview = null;
    memory.tickers.clear();
    memory.symbols.clear();
    memory.pulse = null;
    memory.derivatives = null;
    memory.heatmap = null;
    memory.macro = null;
}

module.exports = {
    saveOverview,
    getOverview,
    saveMacro,
    getMacro,
    saveTickers,
    getTickers,
    saveSymbolSnap,
    getSymbolSnap,
    listSymbolSnaps,
    savePulse,
    getPulse,
    saveDerivatives,
    getDerivatives,
    saveHeatmap,
    getHeatmap,
    appendFundingHist,
    appendOiHist,
    loadFundingRates,
    loadOiSeries,
    percentileOf,
    fundingPercentile,
    saveCollectorMeta,
    resetStoreForTests,
};
