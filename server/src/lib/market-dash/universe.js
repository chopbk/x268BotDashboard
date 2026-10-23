/**
 * Universe top 100–150 USDT-perp: lọc volume & listing age.
 */
const { config } = require("./config");
const { smartMoneyFetch } = require("../smart-money/http");
const { loadAllTickers24h } = require("../smart-money/adapters/tickers");
const { finite } = require("../smart-money/formulas");

/** @type {{ at: number, version: number, symbols: string[], rows: object[], meta: object }} */
let universe = { at: 0, version: 0, symbols: [], rows: [], meta: {} };

const DAY_MS = 24 * 60 * 60_000;

async function loadOnboardDates(force = false) {
    const { body } = await smartMoneyFetch("fapi", "/fapi/v1/exchangeInfo");
    const map = new Map();
    for (const s of body?.symbols || []) {
        if (!s?.symbol) continue;
        const crypto =
            s.status === "TRADING" &&
            s.quoteAsset === "USDT" &&
            (!s.contractType || s.contractType === "PERPETUAL");
        if (!crypto) continue;
        map.set(s.symbol, {
            onboardDate: finite(s.onboardDate) ?? null,
            baseAsset: s.baseAsset || null,
        });
    }
    void force;
    return map;
}

async function buildDashUniverse(opts = {}) {
    const now = Date.now();
    if (!opts.force && universe.symbols.length && now - universe.at < config.universeRefreshMs) {
        return universe;
    }

    const [tickers, meta] = await Promise.all([
        loadAllTickers24h(Boolean(opts.force)),
        loadOnboardDates(Boolean(opts.force)),
    ]);

    const minListingMs = config.minListingDays * DAY_MS;
    const eligible = [];
    for (const t of tickers) {
        const info = meta.get(t.symbol);
        if (!info) continue;
        const qv = t.quoteVolume;
        if (qv == null || qv < config.minQuoteVolumeUsd) continue;
        if (info.onboardDate != null && now - info.onboardDate < minListingMs) continue;
        eligible.push({
            symbol: t.symbol,
            quoteVolume: qv,
            priceChangePercent: t.priceChangePercent ?? null,
            lastPrice: t.lastPrice ?? null,
            baseAsset: info.baseAsset,
            onboardDate: info.onboardDate,
            listingDays:
                info.onboardDate != null ? Math.floor((now - info.onboardDate) / DAY_MS) : null,
        });
    }
    eligible.sort((a, b) => (b.quoteVolume || 0) - (a.quoteVolume || 0));

    const top = eligible.slice(0, Math.min(config.topN, config.maxSymbols));
    const rows = top.map((r, i) => ({ ...r, volumeRank: i + 1 }));

    universe = {
        at: now,
        version: universe.version + 1,
        symbols: rows.map((r) => r.symbol),
        rows,
        meta: {
            topN: config.topN,
            eligibleCount: eligible.length,
            minQuoteVolumeUsd: config.minQuoteVolumeUsd,
            minListingDays: config.minListingDays,
            refreshedAt: new Date(now).toISOString(),
        },
    };
    console.log(
        `[MARKET_DASH] universe v${universe.version} symbols=${universe.symbols.length} eligible=${eligible.length}`
    );
    return universe;
}

function getDashUniverse() {
    return universe;
}

function resetUniverseForTests() {
    universe = { at: 0, version: 0, symbols: [], rows: [], meta: {} };
}

module.exports = {
    buildDashUniverse,
    getDashUniverse,
    resetUniverseForTests,
};
