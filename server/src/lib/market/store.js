/**
 * Lưu snapshot scoring: Mongo bền + memory/Redis cache.
 */
const { getRedisClient } = require("../rate-limit-store");
const MarketScoreLatest = require("../../models/market-score-latest");
const MarketScoreHistory = require("../../models/market-score-history");
const MarketEvent = require("../../models/market-event");
const MarketCollectorState = require("../../models/market-collector-state");
const { FORMULA_VERSION, SCHEMA_VERSION, config } = require("./config");

const memoryLatest = new Map();
const SNAP_TTL_SEC = 6 * 60 * 60;

function snapKey(symbol) {
    return `wb:mkt:snap:${String(symbol).toUpperCase()}`;
}

function metaKey() {
    return "wb:mkt:meta";
}

async function cacheRedis(symbol, snapshot) {
    const client = getRedisClient();
    if (!client?.isReady) return;
    try {
        await client.set(snapKey(symbol), JSON.stringify(snapshot), { EX: SNAP_TTL_SEC });
    } catch (error) {
        console.warn("[marketStore] redis set", error.message || error);
    }
}

async function readRedis(symbol) {
    const client = getRedisClient();
    if (!client?.isReady) return null;
    try {
        const raw = await client.get(snapKey(symbol));
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        console.warn("[marketStore] redis get", error.message || error);
        return null;
    }
}

async function saveLatestSnapshot(snapshot) {
    const symbol = String(snapshot.symbol).toUpperCase();
    memoryLatest.set(symbol, snapshot);
    try {
        await MarketScoreLatest.updateOne(
            { symbol },
            {
                $set: {
                    symbol,
                    calculatedAt: new Date(snapshot.calculatedAt),
                    formulaVersion: snapshot.formulaVersion || FORMULA_VERSION,
                    schemaVersion: SCHEMA_VERSION,
                    universeVersion: snapshot.universeVersion ?? null,
                    qualityOverall: snapshot.qualityOverall || null,
                    snapshot,
                    updatedAt: new Date(),
                },
            },
            { upsert: true }
        );
    } catch (error) {
        console.error("[marketStore] mongo latest", error.message || error);
    }
    await cacheRedis(symbol, snapshot);
}

async function getLatestSnapshot(symbol) {
    const sym = String(symbol || "").toUpperCase();
    if (!sym) return null;
    if (memoryLatest.has(sym)) return memoryLatest.get(sym);
    const cached = await readRedis(sym);
    if (cached) {
        memoryLatest.set(sym, cached);
        return cached;
    }
    try {
        const row = await MarketScoreLatest.findOne({ symbol: sym }).lean();
        if (row?.snapshot) {
            memoryLatest.set(sym, row.snapshot);
            await cacheRedis(sym, row.snapshot);
            return row.snapshot;
        }
    } catch (error) {
        console.warn("[marketStore] mongo get", error.message || error);
    }
    return null;
}

async function listLatestSnapshots(symbols) {
    const out = [];
    const missing = [];
    for (const s of symbols) {
        const snap = await getLatestSnapshot(s);
        if (snap) out.push(snap);
        else missing.push(String(s).toUpperCase());
    }
    if (missing.length) {
        try {
            const rows = await MarketScoreLatest.find({ symbol: { $in: missing } }).lean();
            for (const row of rows) {
                if (row?.snapshot) {
                    memoryLatest.set(row.symbol, row.snapshot);
                    out.push(row.snapshot);
                    await cacheRedis(row.symbol, row.snapshot);
                }
            }
        } catch (error) {
            console.warn("[marketStore] list mongo", error.message || error);
        }
    }
    return out;
}

async function appendHistory(snapshot) {
    const symbol = String(snapshot.symbol).toUpperCase();
    const calculatedAt = new Date(snapshot.calculatedAt);
    // Một bản ghi lịch sử gọn — không nhét full breakdown nếu quá lớn; vẫn giữ composites + tf scores
    const slim = {
        symbol,
        calculatedAt,
        formulaVersion: snapshot.formulaVersion,
        universeVersion: snapshot.universeVersion,
        timeframes: snapshot.timeframes,
        composites: snapshot.composites,
        price: snapshot.price,
        qualityOverall: snapshot.qualityOverall,
    };
    const bucketKey = `${FORMULA_VERSION}|${symbol}|${calculatedAt.toISOString()}`;
    try {
        await MarketScoreHistory.updateOne(
            { bucketKey },
            {
                $setOnInsert: {
                    symbol,
                    calculatedAt,
                    formulaVersion: FORMULA_VERSION,
                    bucketKey,
                    snapshot: slim,
                    expiresAt: new Date(Date.now() + config.retentionDays * 24 * 60 * 60 * 1000),
                },
            },
            { upsert: true }
        );
    } catch (error) {
        if (error?.code !== 11000) console.warn("[marketStore] history", error.message || error);
    }
}

async function listHistory(symbol, { limit = 50 } = {}) {
    const lim = Math.min(config.historyLimitMax, Math.max(1, Number(limit) || 50));
    const rows = await MarketScoreHistory.find({ symbol: String(symbol).toUpperCase() })
        .sort({ calculatedAt: -1 })
        .limit(lim)
        .lean();
    return rows.map((r) => r.snapshot);
}

async function saveCollectorMeta(meta) {
    const client = getRedisClient();
    if (client?.isReady) {
        try {
            await client.set(metaKey(), JSON.stringify(meta), { EX: 24 * 60 * 60 });
        } catch (error) {
            console.warn("[marketStore] meta redis", error.message || error);
        }
    }
    try {
        await MarketCollectorState.updateOne(
            { _id: "market-main" },
            { $set: { metrics: meta, updatedAt: new Date() } },
            { upsert: true }
        );
    } catch (error) {
        console.warn("[marketStore] meta mongo", error.message || error);
    }
}

async function getCollectorMeta() {
    const client = getRedisClient();
    if (client?.isReady) {
        try {
            const raw = await client.get(metaKey());
            if (raw) return JSON.parse(raw);
        } catch {
            /* ignore */
        }
    }
    try {
        const row = await MarketCollectorState.findById("market-main").lean();
        return row?.metrics || null;
    } catch {
        return null;
    }
}

async function recordEvent(event) {
    const symbol = String(event.symbol).toUpperCase();
    const type = event.type;
    const since = new Date(Date.now() - config.eventCooldownMs);
    try {
        const recent = await MarketEvent.findOne({
            symbol,
            type,
            style: event.style || null,
            timeframe: event.timeframe || null,
            createdAt: { $gte: since },
        }).lean();
        if (recent) return null;
        const doc = await MarketEvent.create({
            symbol,
            type,
            style: event.style || null,
            timeframe: event.timeframe || null,
            formulaVersion: FORMULA_VERSION,
            payload: event.payload || {},
            createdAt: new Date(),
        });
        return doc.toObject();
    } catch (error) {
        console.warn("[marketStore] event", error.message || error);
        return null;
    }
}

async function listEvents({ symbol, limit = 50, from } = {}) {
    const lim = Math.min(config.eventLimitMax, Math.max(1, Number(limit) || 50));
    const q = {};
    if (symbol) q.symbol = String(symbol).toUpperCase();
    if (from) q.createdAt = { $gte: new Date(from) };
    return MarketEvent.find(q).sort({ createdAt: -1 }).limit(lim).lean();
}

function resetStoreForTests() {
    memoryLatest.clear();
}

module.exports = {
    saveLatestSnapshot,
    getLatestSnapshot,
    listLatestSnapshots,
    appendHistory,
    listHistory,
    saveCollectorMeta,
    getCollectorMeta,
    recordEvent,
    listEvents,
    resetStoreForTests,
};
