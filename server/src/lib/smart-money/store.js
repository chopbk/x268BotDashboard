/**
 * Snapshot Smart Money: Mongo = nguồn bền (latest + history); Redis = cache nóng.
 */
const { getRedisClient } = require("../rate-limit-store");
const SmartMoneyHistory = require("../../models/smart-money-history");
const SmartMoneySnapshot = require("../../models/smart-money-snapshot");
const { config, SCHEMA_VERSION } = require("./config");

const memoryLatest = new Map();
const SNAP_TTL_SEC = 6 * 60 * 60;

function snapKey(symbol) {
    return `wb:sm:snap:${String(symbol).toUpperCase()}`;
}

function metaKey() {
    return "wb:sm:meta";
}

function historyBucketKey(symbol, collectedAt) {
    const t = new Date(collectedAt).toISOString();
    return `${SCHEMA_VERSION}|${String(symbol).toUpperCase()}|${t}`;
}

async function cacheRedis(symbol, snapshot) {
    const client = getRedisClient();
    if (!client?.isReady) return;
    try {
        await client.set(snapKey(symbol), JSON.stringify(snapshot), { EX: SNAP_TTL_SEC });
    } catch (error) {
        console.warn("[smartMoneyStore] redis set", error.message || error);
    }
}

async function readRedis(symbol) {
    const client = getRedisClient();
    if (!client?.isReady) return null;
    try {
        const raw = await client.get(snapKey(symbol));
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        console.warn("[smartMoneyStore] redis get", error.message || error);
        return null;
    }
}

async function saveLatestToMongo(snapshot) {
    const symbol = String(snapshot.symbol).toUpperCase();
    const collectedAt = new Date(snapshot.collectedAt);
    await SmartMoneySnapshot.updateOne(
        { symbol },
        {
            $set: {
                symbol,
                collectedAt,
                schemaVersion: snapshot.schemaVersion || SCHEMA_VERSION,
                qualityOverall: snapshot.quality?.overall || null,
                cohortId: snapshot.smartMoney?.cohortId || null,
                signalDay: snapshot.smartMoney?.signalDay || null,
                snapshot,
                updatedAt: new Date(),
            },
        },
        { upsert: true }
    );
}

async function readLatestFromMongo(symbol) {
    const row = await SmartMoneySnapshot.findOne({ symbol }).lean();
    if (row?.snapshot) return row.snapshot;
    // Backfill nhẹ từ history nếu chưa có doc latest (lần đầu sau nâng cấp).
    const hist = await SmartMoneyHistory.findOne({ symbol }).sort({ collectedAt: -1 }).lean();
    if (!hist?.snapshot) return null;
    try {
        await saveLatestToMongo(hist.snapshot);
    } catch (error) {
        console.warn("[smartMoneyStore] backfill latest", error.message || error);
    }
    return hist.snapshot;
}

/**
 * Lưu snapshot mới nhất: Mongo trước (nguồn thật), rồi memory + Redis cache.
 */
async function saveLatestSnapshot(snapshot) {
    const symbol = String(snapshot.symbol).toUpperCase();
    memoryLatest.set(symbol, snapshot);
    try {
        await saveLatestToMongo(snapshot);
    } catch (error) {
        console.error("[smartMoneyStore] mongo latest write", error.message || error);
        // Vẫn cố cache Redis để UI không trống trong chu kỳ này.
    }
    await cacheRedis(symbol, snapshot);
}

function snapshotRicher(candidate, baseline) {
    if (!candidate) return false;
    if (!baseline) return true;
    const cSm = candidate.smartMoney?.status === "ok";
    const bSm = baseline.smartMoney?.status === "ok";
    if (cSm && !bSm) return true;
    if (!cSm && bSm) return false;
    const cOi = candidate.openInterest?.status === "ok";
    const bOi = baseline.openInterest?.status === "ok";
    if (cOi && !bOi) return true;
    const ct = new Date(candidate.collectedAt || 0).getTime();
    const bt = new Date(baseline.collectedAt || 0).getTime();
    return ct > bt;
}

async function getLatestSnapshot(symbol) {
    const sym = String(symbol || "").toUpperCase();
    if (!sym) return null;

    const cached = await readRedis(sym);
    // Cache Redis incomplete (SM missing…) → ưu tiên Mongo latest nếu giàu hơn.
    if (cached && cached.smartMoney?.status === "ok" && cached.openInterest?.status === "ok") {
        return cached;
    }

    if (memoryLatest.has(sym)) {
        const mem = memoryLatest.get(sym);
        if (snapshotRicher(mem, cached)) {
            await cacheRedis(sym, mem);
            return mem;
        }
    }

    try {
        const fromMongo = await readLatestFromMongo(sym);
        if (snapshotRicher(fromMongo, cached)) {
            memoryLatest.set(sym, fromMongo);
            await cacheRedis(sym, fromMongo);
            return fromMongo;
        }
    } catch (error) {
        console.warn("[smartMoneyStore] mongo get", error.message || error);
    }
    if (cached) return cached;
    return null;
}

async function listLatestSnapshots(symbols) {
    const out = [];
    const missing = [];
    for (const s of symbols) {
        const sym = String(s).toUpperCase();
        const cached = await readRedis(sym);
        if (cached) {
            out.push(cached);
            continue;
        }
        if (memoryLatest.has(sym)) {
            out.push(memoryLatest.get(sym));
            continue;
        }
        missing.push(sym);
    }
    if (missing.length) {
        try {
            const rows = await SmartMoneySnapshot.find({ symbol: { $in: missing } }).lean();
            const bySym = new Map(rows.map((r) => [r.symbol, r.snapshot]));
            for (const sym of missing) {
                let snap = bySym.get(sym) || null;
                if (!snap) snap = await readLatestFromMongo(sym);
                if (snap) {
                    memoryLatest.set(sym, snap);
                    await cacheRedis(sym, snap);
                    out.push(snap);
                }
            }
        } catch (error) {
            console.warn("[smartMoneyStore] list mongo", error.message || error);
            for (const sym of missing) {
                const snap = await getLatestSnapshot(sym);
                if (snap) out.push(snap);
            }
        }
    }
    return out;
}

async function appendHistory(snapshot) {
    const collectedAt = new Date(snapshot.collectedAt);
    const bucketKey = historyBucketKey(snapshot.symbol, collectedAt);
    const expireAt = new Date(collectedAt.getTime() + config.retentionDays * 24 * 60 * 60 * 1000);
    try {
        await SmartMoneyHistory.updateOne(
            { bucketKey },
            {
                $setOnInsert: {
                    symbol: String(snapshot.symbol).toUpperCase(),
                    collectedAt,
                    bucketKey,
                    schemaVersion: snapshot.schemaVersion || SCHEMA_VERSION,
                    cohortId: snapshot.smartMoney?.cohortId || null,
                    signalDay: snapshot.smartMoney?.signalDay || null,
                    qualityOverall: snapshot.quality?.overall || null,
                    snapshot,
                    _expireAt: expireAt,
                },
            },
            { upsert: true }
        );
    } catch (error) {
        if (error?.code === 11000) return;
        console.warn("[smartMoneyStore] history write", error.message || error);
    }
}

async function getHistory(symbol, { from, to, limit = 100 } = {}) {
    const sym = String(symbol).toUpperCase();
    const q = { symbol: sym };
    if (from || to) {
        q.collectedAt = {};
        if (from) q.collectedAt.$gte = new Date(from);
        if (to) q.collectedAt.$lte = new Date(to);
    }
    const lim = Math.min(config.historyLimitMax, Math.max(1, Number(limit) || 100));
    return SmartMoneyHistory.find(q).sort({ collectedAt: -1 }).limit(lim).lean();
}

async function listKnownSymbols(limit = 200) {
    const symbols = new Set(memoryLatest.keys());
    try {
        const rows = await SmartMoneySnapshot.find({})
            .sort({ updatedAt: -1 })
            .limit(limit)
            .select({ symbol: 1 })
            .lean();
        for (const r of rows) symbols.add(r.symbol);
    } catch (error) {
        console.warn("[smartMoneyStore] listKnownSymbols mongo", error.message || error);
    }
    const client = getRedisClient();
    if (client?.isReady && symbols.size < limit) {
        try {
            const keys = await client.keys("wb:sm:snap:*");
            for (const k of keys) symbols.add(k.replace("wb:sm:snap:", ""));
        } catch {
            // ignore
        }
    }
    if (symbols.size < limit) {
        try {
            const rows = await SmartMoneyHistory.aggregate([
                { $sort: { collectedAt: -1 } },
                { $group: { _id: "$symbol", last: { $first: "$collectedAt" } } },
                { $sort: { last: -1 } },
                { $limit: limit },
            ]);
            for (const r of rows) symbols.add(r._id);
        } catch {
            // ignore
        }
    }
    return [...symbols].slice(0, limit);
}

async function saveCollectorMeta(meta) {
    const client = getRedisClient();
    if (!client?.isReady) return;
    try {
        await client.set(metaKey(), JSON.stringify(meta), { EX: 24 * 3600 });
    } catch (error) {
        console.warn("[smartMoneyStore] meta", error.message || error);
    }
}

async function getCollectorMeta() {
    const client = getRedisClient();
    if (!client?.isReady) return null;
    try {
        const raw = await client.get(metaKey());
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function resetStoreForTests() {
    memoryLatest.clear();
}

module.exports = {
    saveLatestSnapshot,
    getLatestSnapshot,
    listLatestSnapshots,
    appendHistory,
    getHistory,
    listKnownSymbols,
    saveCollectorMeta,
    getCollectorMeta,
    historyBucketKey,
    resetStoreForTests,
};
