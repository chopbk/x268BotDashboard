/**
 * Scheduler Market Dashboard — collector + analyzer loops.
 */
const crypto = require("crypto");
const os = require("os");
const MarketDashCollectorState = require("../../models/market-dash-collector-state");
const { config } = require("./config");
const { buildDashUniverse } = require("./universe");
const { startTickerWs, stopTickerWs, refreshTickers } = require("./collector/tickers");
const { startMarkWs, stopMarkWs, collectDerivatives } = require("./collector/derivatives");
const { collectMacro } = require("./collector/macro");
const { runAnalyzer } = require("./analyzer/run");
const { saveCollectorMeta, saveOverview, getOverview } = require("./store");

const INSTANCE_ID = `${os.hostname()}:${process.pid}:${crypto.randomBytes(4).toString("hex")}`;
const STATE_ID = "mdash-main";

let timers = [];
let started = false;
let busy = { tickers: false, deriv: false, macro: false, analyze: false };

async function acquireLease(now = new Date()) {
    try {
        return await MarketDashCollectorState.findOneAndUpdate(
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
                    updatedAt: now,
                },
            },
            { upsert: true, new: true }
        ).lean();
    } catch (error) {
        if (error?.code === 11000) return null;
        throw error;
    }
}

async function touchLease(patch = {}) {
    await MarketDashCollectorState.updateOne(
        { _id: STATE_ID, leaseOwner: INSTANCE_ID },
        {
            $set: {
                leaseUntil: new Date(Date.now() + config.leaseMs),
                lastRunAt: new Date(),
                ...(patch.lastSuccessAt ? { lastSuccessAt: patch.lastSuccessAt } : {}),
                ...(patch.lastError != null ? { lastError: patch.lastError } : {}),
                ...(patch.metrics ? { metrics: patch.metrics } : {}),
                ...(patch.status ? { status: patch.status } : {}),
                updatedAt: new Date(),
            },
        }
    );
}

async function safeTickers() {
    if (busy.tickers) return;
    busy.tickers = true;
    try {
        await refreshTickers();
    } catch (error) {
        console.warn("[MARKET_DASH] tickers", error.message || error);
    } finally {
        busy.tickers = false;
    }
}

async function safeMacro() {
    if (busy.macro) return;
    busy.macro = true;
    try {
        await collectMacro();
    } catch (error) {
        console.warn("[MARKET_DASH] macro", error.message || error);
    } finally {
        busy.macro = false;
    }
}

async function safeDerivatives() {
    if (busy.deriv) return;
    busy.deriv = true;
    try {
        const lease = await acquireLease();
        if (!lease) return;
        await buildDashUniverse();
        await collectDerivatives({ limit: Math.min(config.topN, 50) });
        await touchLease({ lastSuccessAt: new Date() });
    } catch (error) {
        console.warn("[MARKET_DASH] derivatives", error.message || error);
        await touchLease({ lastError: String(error.message || error) });
    } finally {
        busy.deriv = false;
    }
}

async function safeAnalyze(opts = {}) {
    if (busy.analyze) return { skipped: true, reason: "busy" };
    busy.analyze = true;
    try {
        const lease = await acquireLease();
        if (!lease) return { skipped: true, reason: "no_lease" };
        await buildDashUniverse({ force: Boolean(opts.forceUniverse) });
        const result = await runAnalyzer({ scan: opts.scan !== false });
        const metrics = {
            at: new Date().toISOString(),
            pulse: result.pulse?.score,
            regime1d: result.regimes?.["1d"]?.regime,
            scan: result.scan,
            instanceId: INSTANCE_ID,
        };
        await saveCollectorMeta(metrics);
        await touchLease({ lastSuccessAt: new Date(), metrics, status: "idle" });
        return result;
    } catch (error) {
        console.error("[MARKET_DASH] analyze", error.message || error);
        await touchLease({ lastError: String(error.message || error), status: "error" });
        return { error: String(error.message || error) };
    } finally {
        busy.analyze = false;
    }
}

async function bootstrap() {
    console.log("[MARKET_DASH] bootstrap start");
    await buildDashUniverse({ force: true });
    await refreshTickers({ force: true });
    await collectMacro();
    try {
        await collectDerivatives({ limit: 25 });
    } catch (error) {
        console.warn("[MARKET_DASH] bootstrap deriv", error.message || error);
    }
    await runAnalyzer({ scan: false });
    const overview = await getOverview();
    if (!overview) {
        await saveOverview({
            updatedAt: new Date().toISOString(),
            bootstrapping: true,
        });
    }
    console.log("[MARKET_DASH] bootstrap done");
}

function schedule(fn, ms) {
    const id = setInterval(() => {
        fn().catch((e) => console.warn("[MARKET_DASH] timer", e.message || e));
    }, ms);
    timers.push(id);
    return id;
}

async function startMarketDashJob() {
    if (!config.enabled) {
        console.log("[MARKET_DASH] disabled (MARKET_DASH_ENABLED=false)");
        return;
    }
    if (started) return;
    started = true;
    startTickerWs();
    startMarkWs();
    try {
        await bootstrap();
    } catch (error) {
        console.warn("[MARKET_DASH] bootstrap error", error.message || error);
    }
    schedule(safeTickers, config.tickerPollMs);
    schedule(safeMacro, config.macroPollMs);
    schedule(safeDerivatives, config.derivativesPollMs);
    schedule(() => safeAnalyze({ scan: true }), config.analyzePollMs);
    // Full scan rarer — first analyze after 2 min includes scan via interval
    console.log(
        `[MARKET_DASH] job started ticker=${config.tickerPollMs}ms deriv=${config.derivativesPollMs}ms analyze=${config.analyzePollMs}ms`
    );
}

function stopMarketDashJob() {
    for (const t of timers) clearInterval(t);
    timers = [];
    stopTickerWs();
    stopMarkWs();
    started = false;
}

async function requestDashRefresh() {
    await buildDashUniverse({ force: true });
    await refreshTickers({ force: true });
    await collectMacro();
    await collectDerivatives({ limit: 30 });
    return safeAnalyze({ scan: true, forceUniverse: true });
}

module.exports = {
    startMarketDashJob,
    stopMarketDashJob,
    requestDashRefresh,
    safeAnalyze,
    bootstrap,
};
