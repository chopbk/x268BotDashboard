const { getRedisClient } = require("../rate-limit-store");
const SmartMoneyHistory = require("../../models/smart-money-history");
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

async function saveLatestSnapshot(snapshot) {
    const symbol = String(snapshot.symbol).toUpperCase();
    memoryLatest.set(symbol, snapshot);
    const client = getRedisClient();
    if (!client?.isReady) return;
    try {
        await client.set(snapKey(symbol), JSON.stringify(snapshot), { EX: SNAP_TTL_SEC });
    } catch (error) {
        console.warn("[smartMoneyStore] redis set", error.message || error);
    }
}

async function getLatestSnapshot(symbol) {
    const sym = String(symbol || "").toUpperCase();
    if (!sym) return null;
    const client = getRedisClient();
    if (client?.isReady) {
        try {
            const raw = await client.get(snapKey(sym));
            if (raw) return JSON.parse(raw);
        } catch (error) {
            console.warn("[smartMoneyStore] redis get", error.message || error);
        }
    }
    if (memoryLatest.has(sym)) return memoryLatest.get(sym);
    try {
        const row = await SmartMoneyHistory.findOne({ symbol: sym }).sort({ collectedAt: -1 }).lean();
        return row?.snapshot || null;
    } catch (error) {
        console.warn("[smartMoneyStore] mongo get", error.message || error);
        return null;
    }
}

async function listLatestSnapshots(symbols) {
    const out = [];
    for (const s of symbols) {
        const snap = await getLatestSnapshot(s);
        if (snap) out.push(snap);
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
        if (error?.code === 11000) return; // trùng — bỏ qua
        // Snapshot Redis/memory đã lưu — không để Mongo lỗi làm mất chu kỳ collect.
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
    const client = getRedisClient();
    const symbols = new Set(memoryLatest.keys());
    if (client?.isReady) {
        try {
            const keys = await client.keys("wb:sm:snap:*");
            for (const k of keys) symbols.add(k.replace("wb:sm:snap:", ""));
        } catch {
            // ignore
        }
    }
    if (symbols.size < limit) {
        const rows = await SmartMoneyHistory.aggregate([
            { $sort: { collectedAt: -1 } },
            { $group: { _id: "$symbol", last: { $first: "$collectedAt" } } },
            { $sort: { last: -1 } },
            { $limit: limit },
        ]);
        for (const r of rows) symbols.add(r._id);
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
