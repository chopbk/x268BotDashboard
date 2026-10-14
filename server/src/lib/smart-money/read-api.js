const { config } = require("./config");
const { buildUniverse, getUniverseCached, getSystemWatchlist } = require("./symbol-universe");
const { getLatestSnapshot, listLatestSnapshots, getHistory, listKnownSymbols } = require("./store");
const { listEvents } = require("./detector");
const { getCandidates } = require("./candidates");
const { getCollectorStatus } = require("./scheduler");
const { buildMoneyFlow, toMarketContext } = require("./money-flow");
const SmartMoneyWatchlist = require("../../models/smart-money-watchlist");

function clampLimit(value, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.min(max, Math.floor(n));
}

function normalizeSymbol(raw) {
    const s = String(raw || "").trim().toUpperCase();
    if (!/^[A-Z0-9]{4,25}$/.test(s)) return null;
    return s;
}

async function getStatusPayload() {
    const status = await getCollectorStatus();
    const universe = getUniverseCached();
    return {
        ...status,
        universe: {
            size: universe.symbols?.length || 0,
            refreshedAt: universe.meta?.refreshedAt || null,
            topCount: universe.meta?.topCount ?? null,
        },
        schemaNote: "Thiếu dữ liệu = null. signalDay không phải timestamp snapshot.",
    };
}

async function listSymbolsQuery(query = {}) {
    const universe = getUniverseCached().symbols?.length
        ? getUniverseCached()
        : await buildUniverse().catch(() => getUniverseCached());

    let symbols = universe.symbols?.length ? [...universe.symbols] : await listKnownSymbols(config.listLimitMax);
    const q = String(query.q || query.search || "").trim().toUpperCase();
    if (q) symbols = symbols.filter((s) => s.includes(q));

    const top = clampLimit(query.top, config.maxSymbols, config.topN);
    symbols = symbols.slice(0, top);

    const snaps = await listLatestSnapshots(symbols);
    const bySym = new Map(snaps.map((s) => [s.symbol, s]));
    const trackingMap = new Map((universe.meta?.rows || []).map((r) => [r.symbol, r]));

    let rows = symbols.map((symbol) => {
        const snap = bySym.get(symbol) || null;
        const tracking = trackingMap.get(symbol) || snap?.tracking || { active: false, sources: [] };
        return {
            symbol,
            tracking: {
                active: Boolean(tracking.active !== false && trackingMap.has(symbol)),
                sources: tracking.sources || [],
                label: trackingMap.has(symbol) ? null : "Không còn theo dõi",
            },
            price: snap?.price || null,
            openInterest: snap?.openInterest
                ? { deltaPct: snap.openInterest.deltaPct, qty: snap.openInterest.qty, status: snap.openInterest.status }
                : null,
            smartMoney: snap?.smartMoney
                ? {
                      status: snap.smartMoney.status,
                      bias: snap.derived?.bias,
                      tradersLongQty: snap.smartMoney.traders?.longQty ?? null,
                      tradersShortQty: snap.smartMoney.traders?.shortQty ?? null,
                      whalesLongQty: snap.smartMoney.whales?.longQty ?? null,
                      whalesShortQty: snap.smartMoney.whales?.shortQty ?? null,
                      whalesLongDelta: snap.derived?.deltas?.whalesLongQty ?? null,
                      comparable: snap.smartMoney.comparable,
                      cohortReset: Boolean(snap.derived?.deltas?.cohortReset),
                  }
                : null,
            taker: snap?.taker ? { buySellRatio: snap.taker.buySellRatio, status: snap.taker.status } : null,
            funding: snap?.funding
                ? { currentRate: snap.funding.currentRate, intervalHours: snap.funding.intervalHours, status: snap.funding.status }
                : null,
            derived: snap?.derived
                ? { bias: snap.derived.bias, whaleBias: snap.derived.whaleBias }
                : { bias: "unclear", whaleBias: "unclear" },
            quality: snap?.quality || { overall: "warming", stale: false, missing: ["snapshot"] },
            collectedAt: snap?.collectedAt || null,
        };
    });

    if (query.bias && query.bias !== "all") {
        const b = String(query.bias).toLowerCase();
        rows = rows.filter((r) => (r.derived?.bias || "unclear") === b);
    }
    if (query.anomaly === "1" || query.anomaly === "true") {
        // Lọc nhẹ: quality degraded hoặc bias both với whale khác
        rows = rows.filter(
            (r) =>
                r.quality?.overall === "degraded" ||
                (r.derived?.bias && r.derived?.whaleBias && r.derived.bias !== r.derived.whaleBias)
        );
    }
    if (query.freshness) {
        const f = String(query.freshness);
        rows = rows.filter((r) => {
            if (f === "ok") return r.quality?.overall === "ok";
            if (f === "warming") return r.quality?.overall === "warming" || !r.collectedAt;
            if (f === "stale") return r.quality?.stale || r.quality?.overall === "stale";
            return true;
        });
    }

    const sort = String(query.sort || "volume");
    rows.sort((a, b) => {
        if (sort === "symbol") return a.symbol.localeCompare(b.symbol);
        if (sort === "oi") return Math.abs(b.openInterest?.deltaPct || 0) - Math.abs(a.openInterest?.deltaPct || 0);
        const va = a.price?.quoteVolume24h;
        const vb = b.price?.quoteVolume24h;
        if (va == null && vb == null) return a.symbol.localeCompare(b.symbol);
        if (va == null) return 1;
        if (vb == null) return -1;
        return vb - va;
    });

    return {
        top,
        count: rows.length,
        universeRefreshedAt: universe.meta?.refreshedAt || null,
        rows,
    };
}

async function getSymbolDetail(symbolRaw) {
    const symbol = normalizeSymbol(symbolRaw);
    if (!symbol) return { error: "symbol_invalid", status: 400 };
    const snap = await getLatestSnapshot(symbol);
    const events = await listEvents({ symbol, limit: 20 });
    const universe = getUniverseCached();
    const inUniverse = (universe.symbols || []).includes(symbol);
    if (!snap) {
        return {
            symbol,
            tracking: { active: inUniverse, label: inUniverse ? null : "Không còn theo dõi" },
            snapshot: null,
            events,
            warming: true,
            message: "Đang tích lũy dữ liệu — chưa có snapshot.",
        };
    }
    return {
        symbol,
        tracking: {
            ...(snap.tracking || {}),
            active: inUniverse,
            label: inUniverse ? snap.tracking?.label || null : "Không còn theo dõi",
        },
        snapshot: snap,
        events,
        warming: snap.quality?.overall === "warming",
    };
}

async function getSymbolHistory(symbolRaw, query = {}) {
    const symbol = normalizeSymbol(symbolRaw);
    if (!symbol) return { error: "symbol_invalid", status: 400 };
    const limit = clampLimit(query.limit, config.historyLimitMax, 100);
    const rows = await getHistory(symbol, { from: query.from, to: query.to, limit });
    return {
        symbol,
        count: rows.length,
        points: rows.map((r) => ({
            collectedAt: r.collectedAt,
            cohortId: r.cohortId,
            quality: r.qualityOverall,
            snapshot: r.snapshot,
        })),
    };
}

async function getUserWatchlist(userId) {
    const row = await SmartMoneyWatchlist.findOne({ userId: String(userId) }).lean();
    return { symbols: row?.symbols || [], updatedAt: row?.updatedAt || null };
}

async function setUserWatchlist(userId, symbols) {
    const cleaned = [...new Set((symbols || []).map(normalizeSymbol).filter(Boolean))].slice(0, 50);
    const row = await SmartMoneyWatchlist.findOneAndUpdate(
        { userId: String(userId) },
        { $set: { symbols: cleaned, updatedAt: new Date() } },
        { upsert: true, new: true }
    ).lean();
    return { symbols: row.symbols, updatedAt: row.updatedAt };
}

module.exports = {
    normalizeSymbol,
    clampLimit,
    getStatusPayload,
    listSymbolsQuery,
    getSymbolDetail,
    getSymbolHistory,
    getCandidates,
    listEvents,
    buildMoneyFlow,
    toMarketContext,
    getUserWatchlist,
    setUserWatchlist,
    getSystemWatchlist,
};
