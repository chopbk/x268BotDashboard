/**
 * Scheduler Smart Money — một worker/job qua distributed lease.
 */
const crypto = require("crypto");
const os = require("os");
const SmartMoneyCollectorState = require("../../models/smart-money-collector-state");
const { config } = require("./config");
const { buildUniverse } = require("./symbol-universe");
const { loadAllTickers24h } = require("./adapters/tickers");
const { collectSymbol } = require("./collect");
const { detectForSymbol } = require("./detector");
const { rebuildCandidates } = require("./candidates");
const { listLatestSnapshots, saveCollectorMeta, getLatestSnapshot } = require("./store");

const INSTANCE_ID = `${os.hostname()}:${process.pid}:${crypto.randomBytes(4).toString("hex")}`;
const STATE_ID = "sm-main";

let timer = null;
let running = false;
/** @type {Map<string, number>} */
const lastPartAt = new Map();

function partKey(symbol, part) {
    return `${symbol}|${part}`;
}

async function acquireLease(now = new Date()) {
    try {
        return await SmartMoneyCollectorState.findOneAndUpdate(
            {
                _id: STATE_ID,
                $or: [{ leaseUntil: { $lte: now } }, { leaseUntil: null }, { leaseOwner: INSTANCE_ID }],
            },
            {
                $set: {
                    leaseOwner: INSTANCE_ID,
                    leaseUntil: new Date(now.getTime() + config.leaseMs),
                    status: "running",
                    lastError: null,
                },
            },
            { upsert: true, new: true }
        ).lean();
    } catch (error) {
        if (error?.code === 11000) return null;
        throw error;
    }
}

async function releaseLease(patch = {}) {
    await SmartMoneyCollectorState.updateOne(
        { _id: STATE_ID, leaseOwner: INSTANCE_ID },
        {
            $set: {
                leaseOwner: null,
                leaseUntil: null,
                status: patch.status || "idle",
                lastRunAt: new Date(),
                ...(patch.lastSuccessAt ? { lastSuccessAt: patch.lastSuccessAt } : {}),
                ...(patch.lastError != null ? { lastError: patch.lastError } : {}),
                ...(patch.metrics ? { metrics: patch.metrics } : {}),
                ...(patch.coverage ? { coverage: patch.coverage } : {}),
            },
        }
    );
}

function due(symbol, part, intervalMs, now) {
    const at = lastPartAt.get(partKey(symbol, part)) || 0;
    return now - at >= intervalMs;
}

function markDone(symbol, part, now) {
    lastPartAt.set(partKey(symbol, part), now);
}

async function runCycle(options = {}) {
    if (!config.enabled && !options.force) return { skipped: true, reason: "disabled" };
    if (running) return { skipped: true, reason: "local_busy" };
    running = true;
    const now = Date.now();
    const lease = await acquireLease(new Date(now));
    if (!lease) {
        running = false;
        return { skipped: true, reason: "no_lease" };
    }

    const metrics = {
        startedAt: new Date(now).toISOString(),
        symbolsAttempted: 0,
        symbolsOk: 0,
        errors: 0,
        cooldownStops: 0,
        instanceId: INSTANCE_ID,
    };

    try {
        const universe = await buildUniverse({ force: Boolean(options.refreshUniverse) });
        const tickers = await loadAllTickers24h();
        const tickerMap = new Map(tickers.map((t) => [t.symbol, t]));
        const trackingBySymbol = new Map((universe.meta.rows || []).map((r) => [r.symbol, r]));

        // Không backfill dồn: mỗi cycle chỉ xử lý một phần symbol đến hạn.
        const symbols = universe.symbols || [];
        const maxPerCycle = options.force ? symbols.length : Math.min(8, symbols.length);

        let processed = 0;
        for (const symbol of symbols) {
            if (processed >= maxPerCycle) break;
            const tracking = trackingBySymbol.get(symbol) || { active: true, sources: [] };
            const parts = [];
            if (options.force || due(symbol, "oi", config.oiIntervalMs, now)) parts.push("oi");
            if (options.force || due(symbol, "funding", config.fundingIntervalMs, now)) parts.push("funding");
            if (options.force || due(symbol, "top", config.topTraderIntervalMs, now)) parts.push("top");
            // Smart Money chậm hơn — chỉ vài symbol / cycle
            if (options.force || due(symbol, "smartMoney", config.smartMoneyIntervalMs, now)) {
                if (options.force || processed < 3) parts.push("smartMoney");
            }
            if (!parts.length) continue;

            metrics.symbolsAttempted += 1;
            try {
                const price = tickerMap.get(symbol) || null;
                await collectSymbol(symbol, { price, tracking, parts });
                for (const p of parts) markDone(symbol, p, Date.now());
                metrics.symbolsOk += 1;

                const latest = await getLatestSnapshot(symbol);
                if (latest) await detectForSymbol(symbol, latest);
            } catch (error) {
                metrics.errors += 1;
                if (error.code === "COOLDOWN" || error.code === "RATE_LIMIT") {
                    metrics.cooldownStops += 1;
                    console.warn("[smartMoneyScheduler] cooldown stop", error.message || error);
                    break;
                }
                console.warn("[smartMoneyScheduler]", symbol, error.message || error);
            }
            processed += 1;
        }

        // Đánh dấu symbol đã biết nhưng không còn trong universe
        const known = await listLatestSnapshots(symbols);
        const snaps = [];
        for (const s of symbols) {
            const snap = known.find((k) => k.symbol === s) || (await getLatestSnapshot(s));
            if (snap) snaps.push(snap);
        }
        // inactive: có snapshot nhưng không trong universe active
        // (giữ history; UI đọc tracking)

        await rebuildCandidates(snaps);

        const coverage = {
            universeSize: symbols.length,
            withSnapshot: snaps.length,
            refreshedAt: universe.meta.refreshedAt,
        };
        metrics.finishedAt = new Date().toISOString();
        await saveCollectorMeta({ metrics, coverage, instanceId: INSTANCE_ID });
        await releaseLease({
            status: "idle",
            lastSuccessAt: new Date(),
            metrics,
            coverage,
        });
        return { skipped: false, metrics, coverage };
    } catch (error) {
        console.error("[smartMoneyScheduler]", error.message || error);
        await releaseLease({
            status: "error",
            lastError: String(error.message || error).slice(0, 500),
            metrics,
        });
        return { skipped: false, error: String(error.message || error), metrics };
    } finally {
        running = false;
    }
}

async function startSmartMoneyJob() {
    if (timer) return timer;
    if (!config.enabled) {
        console.log("[smartMoneyScheduler] disabled (SMART_MONEY_ENABLED)");
        return null;
    }
    console.log("[smartMoneyScheduler] start", INSTANCE_ID);
    // Delay khởi động để tránh stampede khi nhiều instance restart
    setTimeout(() => {
        runCycle().catch((e) => console.error("[smartMoneyScheduler:init]", e.message || e));
    }, 15_000 + Math.floor(Math.random() * 10_000));
    timer = setInterval(() => {
        runCycle().catch((e) => console.error("[smartMoneyScheduler]", e.message || e));
    }, config.schedulerTickMs);
    timer.unref?.();
    return timer;
}

function stopSmartMoneyJob() {
    if (timer) clearInterval(timer);
    timer = null;
}

async function getCollectorStatus() {
    const state = await SmartMoneyCollectorState.findById(STATE_ID).lean();
    return {
        enabled: config.enabled,
        instanceId: INSTANCE_ID,
        state: state || null,
        intervals: {
            oiMs: config.oiIntervalMs,
            fundingMs: config.fundingIntervalMs,
            topTraderMs: config.topTraderIntervalMs,
            smartMoneyMs: config.smartMoneyIntervalMs,
            universeMs: config.universeRefreshMs,
        },
        topN: config.topN,
        maxSymbols: config.maxSymbols,
    };
}

/** Refresh hợp lệ — không bypass TTL; chỉ đánh dấu due sớm hơn một bậc. */
async function requestRefresh({ symbols = [], actorId = null } = {}) {
    const list = (symbols.length ? symbols : []).map((s) => String(s).toUpperCase()).slice(0, 10);
    for (const sym of list) {
        // Đưa due sớm bằng cách lùi lastPartAt, vẫn tôn trọng gap HTTP.
        for (const part of ["oi", "funding", "top", "smartMoney"]) {
            lastPartAt.set(partKey(sym, part), Date.now() - config.oiIntervalMs);
        }
    }
    const result = await runCycle({ force: list.length > 0, refreshUniverse: list.length === 0 });
    return { ...result, requestedBy: actorId || null, symbols: list };
}

module.exports = {
    startSmartMoneyJob,
    stopSmartMoneyJob,
    runCycle,
    requestRefresh,
    getCollectorStatus,
    INSTANCE_ID,
};
