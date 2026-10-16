/**
 * Scheduler scoring Thị trường — lease Mongo, bootstrap có concurrency thấp.
 */
const crypto = require("crypto");
const os = require("os");
const MarketCollectorState = require("../../models/market-collector-state");
const { config, TIMEFRAMES, INTERVAL_MS, FORMULA_VERSION } = require("./config");
const { buildMarketUniverse } = require("./universe");
const { loadAllTickers24h } = require("../smart-money/adapters/tickers");
const { scoreSymbol, mapPool } = require("./score-symbol");
const {
    saveLatestSnapshot,
    getLatestSnapshot,
    listLatestSnapshots,
    appendHistory,
    saveCollectorMeta,
} = require("./store");

const INSTANCE_ID = `${os.hostname()}:${process.pid}:${crypto.randomBytes(4).toString("hex")}`;
const STATE_ID = "market-main";

let timer = null;
let running = false;
/** @type {Map<string, number>} symbol|tf → last candleCloseTime scored */
const lastScoredClose = new Map();

async function acquireLease(now = new Date()) {
    try {
        return await MarketCollectorState.findOneAndUpdate(
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
    await MarketCollectorState.updateOne(
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
            },
        }
    );
}

function needsRescore(symbol, prev, now) {
    if (!prev?.timeframes) return true;
    for (const tf of TIMEFRAMES) {
        const frame = prev.timeframes[tf];
        if (!frame?.candleCloseTime) return true;
        const interval = INTERVAL_MS[tf];
        // Nến mới đóng khi now > candleCloseTime + nhỏ buffer và đã qua interval kế
        if (now > frame.candleCloseTime + interval) return true;
        const key = `${symbol}|${tf}`;
        const scored = lastScoredClose.get(key);
        if (scored !== frame.candleCloseTime) return true;
    }
    return false;
}

function markScored(snapshot) {
    for (const tf of TIMEFRAMES) {
        const close = snapshot.timeframes?.[tf]?.candleCloseTime;
        if (close != null) lastScoredClose.set(`${snapshot.symbol}|${tf}`, close);
    }
}

async function runCycle(options = {}) {
    if (!config.enabled && !options.force && !options.bootstrap) {
        return { skipped: true, reason: "disabled" };
    }
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
        bootstrap: false,
        instanceId: INSTANCE_ID,
        formulaVersion: FORMULA_VERSION,
    };

    try {
        const universe = await buildMarketUniverse({ force: Boolean(options.refreshUniverse || options.bootstrap) });
        const tickers = await loadAllTickers24h(Boolean(options.bootstrap));
        const tickerMap = new Map(tickers.map((t) => [t.symbol, t]));
        const rowMeta = new Map((universe.meta.rows || []).map((r) => [r.symbol, r]));
        const symbols = universe.symbols || [];

        let bootstrap = Boolean(options.bootstrap || options.force);
        if (!bootstrap && symbols.length) {
            const sample = await listLatestSnapshots(symbols.slice(0, 3));
            bootstrap = sample.length === 0;
        }
        metrics.bootstrap = bootstrap;

        const due = [];
        for (const symbol of symbols) {
            const prev = await getLatestSnapshot(symbol);
            if (bootstrap || options.force || needsRescore(symbol, prev, now)) {
                due.push({ symbol, prev });
            }
        }

        // Bootstrap: giới hạn mỗi chu kỳ để không burst 250 klines
        const batch = bootstrap ? due.slice(0, 8) : due.slice(0, 20);
        metrics.queued = due.length;
        metrics.batch = batch.length;

        await mapPool(batch, config.fetchConcurrency, async ({ symbol, prev }) => {
            metrics.symbolsAttempted += 1;
            try {
                const meta = rowMeta.get(symbol) || {};
                const ticker = tickerMap.get(symbol) || meta;
                const snapshot = await scoreSymbol(symbol, {
                    ticker,
                    universeVersion: universe.version,
                    prev,
                    force: bootstrap || options.force,
                    volumeRank: meta.volumeRank,
                    inTop: meta.inTop !== false,
                    now,
                });
                await saveLatestSnapshot(snapshot);
                await appendHistory(snapshot);
                markScored(snapshot);
                metrics.symbolsOk += 1;
            } catch (error) {
                metrics.errors += 1;
                console.error(`[marketScheduler] ${symbol}`, error.message || error);
            }
        });

        const coverageReady = (await listLatestSnapshots(symbols)).filter((s) => s.qualityOverall === "ready").length;
        metrics.coverage = { ready: coverageReady, total: symbols.length };
        metrics.finishedAt = new Date().toISOString();
        metrics.universeVersion = universe.version;
        await saveCollectorMeta(metrics);
        await releaseLease({ status: "idle", lastSuccessAt: new Date(), metrics });
        running = false;
        return { ok: true, metrics };
    } catch (error) {
        console.error("[marketScheduler] cycle", error.message || error);
        await releaseLease({ status: "error", lastError: error.message || String(error), metrics });
        running = false;
        return { ok: false, error: error.message || String(error), metrics };
    }
}

async function requestRefresh() {
    return runCycle({ bootstrap: true, force: true, refreshUniverse: true });
}

async function startMarketJob() {
    if (!config.enabled) {
        console.log("[marketScheduler] disabled (MARKET_ENABLED=false)");
        return;
    }
    console.log(`[marketScheduler] start tick=${config.schedulerTickMs}ms topN=${config.topN}`);
    // Chạy nhẹ sau boot — không block listen
    setTimeout(() => {
        runCycle({ bootstrap: true }).catch((e) => console.error("[marketScheduler] boot", e.message || e));
    }, 8_000);
    timer = setInterval(() => {
        runCycle().catch((e) => console.error("[marketScheduler] tick", e.message || e));
    }, config.schedulerTickMs);
    if (typeof timer.unref === "function") timer.unref();
}

function stopMarketJob() {
    if (timer) clearInterval(timer);
    timer = null;
}

module.exports = {
    startMarketJob,
    stopMarketJob,
    runCycle,
    requestRefresh,
};
