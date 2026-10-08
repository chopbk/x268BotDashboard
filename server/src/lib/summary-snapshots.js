const crypto = require("crypto");
const os = require("os");
const SummarySnapshot = require("../models/summary-snapshot");
const { getSystemSummary, normalizeSummaryRange } = require("./system-summary");
const { ensureSummaryIndexes } = require("./summary-indexes");

const FORMULA_VERSION = "v3";
const PRECOMPUTED_RANGES = Object.freeze(["today", "3d", "7d", "30d", "90d"]);
const ALL_RANGES = Object.freeze([...PRECOMPUTED_RANGES, "all"]);
const REGULAR_TTL_MS = 2 * 60 * 1000;
const ALL_TTL_MS = 15 * 60 * 1000;
const LEASE_MS = 2 * 60 * 1000;
const SCHEDULER_INTERVAL_MS = 60 * 1000;
const INSTANCE_ID = `${os.hostname()}:${process.pid}:${crypto.randomBytes(6).toString("hex")}`;
let scheduler = null;

function snapshotKey(range) { return `${FORMULA_VERSION}:${range}`; }
function ttlFor(range) { return range === "all" ? ALL_TTL_MS : REGULAR_TTL_MS; }
function publicSnapshot(snapshot, cached = true) {
    return {
        ...(snapshot.payload || {}),
        cached,
        snapshot: {
            range: snapshot.range,
            formulaVersion: snapshot.formulaVersion,
            status: snapshot.status,
            generatedAt: snapshot.generatedAt,
            staleAt: snapshot.staleAt,
        },
    };
}

async function acquireLease(range, now, owner = INSTANCE_ID) {
    const key = snapshotKey(range);
    try {
        return await SummarySnapshot.findOneAndUpdate(
            { _id: key, $or: [{ leaseUntil: { $lte: now } }, { leaseUntil: null }, { leaseOwner: owner }] },
            {
                $set: { range, formulaVersion: FORMULA_VERSION, status: "refreshing", leaseOwner: owner, leaseUntil: new Date(now.getTime() + LEASE_MS), lastError: null },
                $setOnInsert: { payload: null, generatedAt: null, staleAt: null },
            },
            { upsert: true, new: true }
        ).lean();
    } catch (error) {
        if (error?.code === 11000) return null;
        throw error;
    }
}

async function refreshSummarySnapshot(rangeInput, options = {}) {
    const range = normalizeSummaryRange(rangeInput);
    const now = options.now || new Date();
    const owner = options.owner || INSTANCE_ID;
    const lease = await acquireLease(range, now, owner);
    if (!lease) return null;
    try {
        const payload = await getSystemSummary(range, now);
        const generatedAt = new Date();
        const snapshot = await SummarySnapshot.findOneAndUpdate(
            { _id: snapshotKey(range), leaseOwner: owner },
            { $set: { payload, status: "ready", generatedAt, staleAt: new Date(generatedAt.getTime() + ttlFor(range)), leaseOwner: null, leaseUntil: null, lastError: null } },
            { new: true }
        ).lean();
        return snapshot;
    } catch (error) {
        await SummarySnapshot.updateOne(
            { _id: snapshotKey(range), leaseOwner: owner },
            { $set: { status: "error", lastError: String(error.message || error).slice(0, 500), leaseOwner: null, leaseUntil: null } }
        );
        throw error;
    }
}

function refreshInBackground(range) {
    refreshSummarySnapshot(range).catch((error) => console.error(`[summary-snapshot:${range}]`, error.message || error));
}

async function getSummarySnapshot(rangeInput = "today", now = new Date()) {
    const range = normalizeSummaryRange(rangeInput);
    let snapshot = await SummarySnapshot.findById(snapshotKey(range)).lean();
    if (!snapshot?.payload) {
        snapshot = await refreshSummarySnapshot(range, { now });
        if (!snapshot) snapshot = await SummarySnapshot.findById(snapshotKey(range)).lean();
        if (!snapshot?.payload) throw Object.assign(new Error("Tổng kết đang được tính, vui lòng thử lại"), { status: 503 });
        return publicSnapshot(snapshot, false);
    }
    if (!snapshot.staleAt || new Date(snapshot.staleAt) <= now) {
        refreshInBackground(range);
        return publicSnapshot({ ...snapshot, status: "refreshing" });
    }
    return publicSnapshot(snapshot);
}

async function refreshDueSnapshots(now = new Date()) {
    const snapshots = await SummarySnapshot.find({ _id: { $in: ALL_RANGES.map(snapshotKey) } }).select("_id staleAt status").lean();
    const byId = new Map(snapshots.map((row) => [row._id, row]));
    await Promise.all(ALL_RANGES.map(async (range) => {
        const row = byId.get(snapshotKey(range));
        if (!row || !row.staleAt || new Date(row.staleAt) <= now) await refreshSummarySnapshot(range, { now });
    }));
}

async function startSummarySnapshotJob() {
    if (scheduler) return scheduler;
    await ensureSummaryIndexes();
    refreshDueSnapshots().catch((error) => console.error("[summary-snapshot-job:init]", error.message || error));
    scheduler = setInterval(() => refreshDueSnapshots().catch((error) => console.error("[summary-snapshot-job]", error.message || error)), SCHEDULER_INTERVAL_MS);
    scheduler.unref?.();
    return scheduler;
}

function stopSummarySnapshotJob() {
    if (scheduler) clearInterval(scheduler);
    scheduler = null;
}

async function forceSummarySnapshot(rangeInput, now = new Date()) {
    const range = normalizeSummaryRange(rangeInput);
    const snapshot = await refreshSummarySnapshot(range, { now });
    if (snapshot?.payload) return publicSnapshot(snapshot, false);
    const current = await SummarySnapshot.findById(snapshotKey(range)).lean();
    if (current?.payload) return publicSnapshot(current, true);
    const error = new Error("Tổng kết đang được tính, vui lòng thử lại");
    error.status = 409;
    throw error;
}

module.exports = { FORMULA_VERSION, PRECOMPUTED_RANGES, ALL_RANGES, REGULAR_TTL_MS, ALL_TTL_MS, LEASE_MS, snapshotKey, ttlFor, acquireLease, refreshSummarySnapshot, getSummarySnapshot, forceSummarySnapshot, refreshDueSnapshots, startSummarySnapshotJob, stopSummarySnapshotJob };
