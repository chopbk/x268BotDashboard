/**
 * Hợp nhất top volume + sticky + watchlist hệ thống + symbol đang có vị thế (không lộ user).
 */
const { config } = require("./config");
const { loadExchangeInfo } = require("./adapters/exchange-info");
const { loadAllTickers24h } = require("./adapters/tickers");
const { getRedisClient } = require("../rate-limit-store");

/** @type {{ at: number, symbols: string[], meta: object }} */
let universe = { at: 0, symbols: [], meta: {} };
/** @type {Map<string, number>} symbol → stickyUntil */
const sticky = new Map();
/** @type {Set<string>} */
const systemWatchlist = new Set();

function setSystemWatchlist(symbols = []) {
    systemWatchlist.clear();
    for (const s of symbols) {
        const sym = String(s || "").trim().toUpperCase();
        if (sym) systemWatchlist.add(sym);
    }
}

function getSystemWatchlist() {
    return [...systemWatchlist];
}

async function loadOpenPositionSymbols() {
    const client = getRedisClient();
    if (!client?.isReady) return [];
    try {
        // Quét nhẹ các key sổ sàn; không gắn username vào kết quả public.
        const keys = await client.keys("wb:ex:*");
        const symbols = new Set();
        for (const key of keys) {
            if (key.includes(":refresh") || key.includes(":notify") || key.includes(":cooldown")) continue;
            try {
                const raw = await client.get(key);
                if (!raw) continue;
                const parsed = JSON.parse(raw);
                const positions = parsed?.positions || parsed?.positionRisk || [];
                for (const p of Array.isArray(positions) ? positions : []) {
                    const sym = String(p.symbol || p.instrumentId || "").trim().toUpperCase();
                    const amt = Math.abs(Number(p.positionAmt ?? p.size ?? 0));
                    if (sym && amt > 0) symbols.add(sym.replace(/-/g, "").replace(/SWAP$/i, ""));
                }
            } catch {
                // ignore bad key
            }
        }
        return [...symbols];
    } catch (error) {
        console.warn("[symbolUniverse] open positions", error.message || error);
        return [];
    }
}

async function buildUniverse(opts = {}) {
    const now = Date.now();
    if (!opts.force && universe.symbols.length && now - universe.at < config.universeRefreshMs) {
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

    const top = eligible.slice(0, config.topN).map((t) => t.symbol);
    const topSet = new Set(top);

    // Sticky: symbol từng trong top vẫn giữ đến stickyUntil
    for (const sym of top) {
        sticky.set(sym, now + config.stickyMs);
    }
    const stickyAlive = [];
    for (const [sym, until] of sticky) {
        if (until < now && !topSet.has(sym)) sticky.delete(sym);
        else if (!topSet.has(sym) && info.get(sym)?.cryptoUsdtPerp) stickyAlive.push(sym);
    }

    let openSyms = [];
    try {
        openSyms = await loadOpenPositionSymbols();
    } catch {
        openSyms = [];
    }
    openSyms = openSyms.filter((s) => info.get(s)?.cryptoUsdtPerp);

    const merged = [];
    const seen = new Set();
    const push = (sym, source) => {
        if (!sym || seen.has(sym)) return;
        if (!info.get(sym)?.cryptoUsdtPerp && source !== "watchlist") return;
        if (merged.length >= config.maxSymbols) return;
        seen.add(sym);
        merged.push({ symbol: sym, sources: [source], active: true });
    };

    for (const s of top) push(s, "top_volume");
    for (const s of stickyAlive) push(s, "sticky");
    for (const s of systemWatchlist) push(s, "system_watchlist");
    for (const s of openSyms) push(s, "open_interest_book");

    // Đánh dấu inactive trước đó vẫn trong sticky map nhưng không còn trong merged — giữ history riêng ở store.
    universe = {
        at: now,
        symbols: merged.map((m) => m.symbol),
        meta: {
            topN: config.topN,
            maxSymbols: config.maxSymbols,
            topCount: top.length,
            stickyCount: stickyAlive.length,
            watchlistCount: systemWatchlist.size,
            openBookCount: openSyms.length,
            // Không trả danh sách openBook symbols riêng cho client để tránh suy ra vị thế người khác.
            refreshedAt: new Date(now).toISOString(),
            rows: merged,
        },
    };
    return universe;
}

function getUniverseCached() {
    return universe;
}

function resetUniverseForTests() {
    universe = { at: 0, symbols: [], meta: {} };
    sticky.clear();
    systemWatchlist.clear();
}

module.exports = {
    buildUniverse,
    getUniverseCached,
    setSystemWatchlist,
    getSystemWatchlist,
    resetUniverseForTests,
};
