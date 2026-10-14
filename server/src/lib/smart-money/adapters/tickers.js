const { smartMoneyFetch } = require("../http");
const { finite } = require("../formulas");

let cache = { at: 0, rows: [] };
const TTL_MS = 55_000;

async function loadAllTickers24h(force = false) {
    if (!force && cache.rows.length && Date.now() - cache.at < TTL_MS) return cache.rows;
    const { body } = await smartMoneyFetch("fapi", "/fapi/v1/ticker/24hr");
    if (!Array.isArray(body)) {
        const err = new Error("ticker_24hr_invalid");
        err.code = "SOURCE_ERROR";
        throw err;
    }
    const rows = body.map((t) => ({
        symbol: t.symbol,
        lastPrice: finite(t.lastPrice),
        priceChangePercent: finite(t.priceChangePercent),
        quoteVolume: finite(t.quoteVolume),
        volume: finite(t.volume),
    }));
    cache = { at: Date.now(), rows };
    return rows;
}

function resetTickersCacheForTests() {
    cache = { at: 0, rows: [] };
}

module.exports = { loadAllTickers24h, resetTickersCacheForTests };
