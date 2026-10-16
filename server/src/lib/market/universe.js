/**
 * Universe top N crypto USDT perpetual theo quoteVolume 24h.
 * Tái dùng adapter exchange-info / tickers của Smart Money.
 */
const { config } = require("./config");
const { loadExchangeInfo } = require("../smart-money/adapters/exchange-info");
const { loadAllTickers24h } = require("../smart-money/adapters/tickers");

/** @type {{ at: number, version: number, symbols: string[], meta: object }} */
let universe = { at: 0, version: 0, symbols: [], meta: {} };
/** @type {Map<string, number>} */
const sticky = new Map();

async function buildMarketUniverse(opts = {}) {
    const now = Date.now();
    if (!opts.force && universe.symbols.length && now - universe.at < config.universeRefreshMs) {
        return universe;
    }

    if (config.forceSymbols?.length) {
        const rows = config.forceSymbols.map((symbol, i) => ({
            symbol,
            volumeRank: i + 1,
            quoteVolume: null,
            sources: ["force_env"],
            inTop: true,
        }));
        universe = {
            at: now,
            version: universe.version + 1,
            symbols: rows.map((r) => r.symbol),
            meta: {
                topN: config.topN,
                refreshedAt: new Date(now).toISOString(),
                forceSymbols: true,
                rows,
            },
        };
        return universe;
    }

    const info = await loadExchangeInfo(opts.force);
    const tickers = await loadAllTickers24h(opts.force);
    const eligible = tickers
        .filter((t) => {
            const meta = info.get(t.symbol);
            return meta?.cryptoUsdtPerp && t.quoteVolume != null;
        })
        .sort((a, b) => (b.quoteVolume || 0) - (a.quoteVolume || 0));

    const top = eligible.slice(0, config.topN);
    const topSet = new Set(top.map((t) => t.symbol));
    for (const t of top) sticky.set(t.symbol, now + config.stickyMs);

    const stickyAlive = [];
    for (const [sym, until] of sticky) {
        if (until < now && !topSet.has(sym)) sticky.delete(sym);
        else if (!topSet.has(sym) && info.get(sym)?.cryptoUsdtPerp) stickyAlive.push(sym);
    }

    const rows = [];
    const seen = new Set();
    let rank = 0;
    for (const t of top) {
        rank += 1;
        seen.add(t.symbol);
        rows.push({
            symbol: t.symbol,
            volumeRank: rank,
            quoteVolume: t.quoteVolume,
            priceChangePercent: t.priceChangePercent ?? null,
            lastPrice: t.lastPrice ?? t.mark ?? null,
            sources: ["top_volume"],
            inTop: true,
        });
    }
    for (const sym of stickyAlive) {
        if (seen.has(sym) || rows.length >= config.maxSymbols) continue;
        seen.add(sym);
        const t = eligible.find((x) => x.symbol === sym);
        rows.push({
            symbol: sym,
            volumeRank: null,
            quoteVolume: t?.quoteVolume ?? null,
            priceChangePercent: t?.priceChangePercent ?? null,
            lastPrice: t?.lastPrice ?? null,
            sources: ["sticky"],
            inTop: false,
        });
    }

    universe = {
        at: now,
        version: universe.version + 1,
        symbols: rows.map((r) => r.symbol),
        meta: {
            topN: config.topN,
            topCount: top.length,
            stickyCount: stickyAlive.length,
            refreshedAt: new Date(now).toISOString(),
            rows,
        },
    };
    return universe;
}

function getMarketUniverse() {
    return universe;
}

function resetUniverseForTests() {
    universe = { at: 0, version: 0, symbols: [], meta: {} };
    sticky.clear();
}

module.exports = {
    buildMarketUniverse,
    getMarketUniverse,
    resetUniverseForTests,
};
