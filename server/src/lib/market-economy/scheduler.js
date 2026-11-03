/**
 * Economy collectors — per-task lease, no-overlap, backoff.
 */
const os = require("os");
const crypto = require("crypto");
const { config } = require("./config");
const { collectYields } = require("./collector/yields");
const { collectCalendar } = require("./collector/calendar");
const { collectNews } = require("./collector/news");
const { MarketEconomyCollectorState, saveCollectorMeta } = require("./store");

const INSTANCE_ID = `${os.hostname()}:${process.pid}:${crypto.randomBytes(3).toString("hex")}`;
const busy = { yields: false, calendar: false, news: false };
const backoffUntil = { yields: 0, calendar: 0, news: 0 };
const failStreak = { yields: 0, calendar: 0, news: 0 };
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
let timers = [];
let started = false;

async function acquireLease(taskId) {
    const now = new Date();
    const until = new Date(now.getTime() + config.leaseMs);
    const doc = await MarketEconomyCollectorState.findOneAndUpdate(
        {
            _id: taskId,
            $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }, { leaseOwner: INSTANCE_ID }],
        },
        {
            $set: {
                leaseOwner: INSTANCE_ID,
                leaseUntil: until,
                status: "running",
                lastRunAt: now,
                updatedAt: now,
            },
        },
        { upsert: true, new: true }
    );
    return doc?.leaseOwner === INSTANCE_ID;
}

async function touchLease(taskId, patch = {}) {
    const now = new Date();
    await MarketEconomyCollectorState.updateOne(
        { _id: taskId, leaseOwner: INSTANCE_ID },
        {
            $set: {
                leaseUntil: new Date(now.getTime() + config.leaseMs),
                updatedAt: now,
                ...patch,
            },
        }
    );
}

function scheduleBackoff(task, retryAfterHeader) {
    failStreak[task] += 1;
    if (failStreak[task] >= 5) {
        backoffUntil[task] = Date.now() + 15 * 60_000;
        console.warn(`[MARKET_ECONOMY] circuit open ${task}`);
        return;
    }
    let ms = BACKOFF_MS[Math.min(failStreak[task] - 1, BACKOFF_MS.length - 1)];
    if (retryAfterHeader) {
        const sec = Number(retryAfterHeader);
        if (Number.isFinite(sec) && sec > 0) ms = Math.max(ms, sec * 1000);
    }
    const jitter = Math.floor(Math.random() * 5000);
    backoffUntil[task] = Date.now() + ms + jitter;
}

function clearBackoff(task) {
    failStreak[task] = 0;
    backoffUntil[task] = 0;
}

async function safeYields() {
    if (!config.enabled || busy.yields) return;
    if (Date.now() < backoffUntil.yields) return;
    busy.yields = true;
    try {
        const ok = await acquireLease("economy-yields");
        if (!ok) return;
        await collectYields();
        await touchLease("economy-yields", { status: "idle", lastSuccessAt: new Date(), lastError: null });
        clearBackoff("yields");
    } catch (error) {
        console.warn("[MARKET_ECONOMY] yields", error.message || error);
        scheduleBackoff("yields", error.retryAfter);
        await saveCollectorMeta("economy-yields", {
            status: "error",
            lastError: String(error.message || error).slice(0, 500),
        });
    } finally {
        busy.yields = false;
    }
}

async function safeCalendar() {
    if (!config.enabled || busy.calendar) return;
    if (Date.now() < backoffUntil.calendar) return;
    busy.calendar = true;
    try {
        const ok = await acquireLease("economy-calendar");
        if (!ok) return;
        await collectCalendar();
        await touchLease("economy-calendar", { status: "idle", lastSuccessAt: new Date(), lastError: null });
        clearBackoff("calendar");
    } catch (error) {
        console.warn("[MARKET_ECONOMY] calendar", error.message || error);
        scheduleBackoff("calendar", error.retryAfter);
        await saveCollectorMeta("economy-calendar", {
            status: "error",
            lastError: String(error.message || error).slice(0, 500),
        });
    } finally {
        busy.calendar = false;
    }
}

async function safeNews() {
    if (!config.enabled || !config.newsEnabled || busy.news) return;
    if (Date.now() < backoffUntil.news) return;
    busy.news = true;
    try {
        const ok = await acquireLease("economy-news");
        if (!ok) return;
        await collectNews();
        await touchLease("economy-news", { status: "idle", lastSuccessAt: new Date(), lastError: null });
        clearBackoff("news");
    } catch (error) {
        console.warn("[MARKET_ECONOMY] news", error.message || error);
        scheduleBackoff("news", error.retryAfter);
        await saveCollectorMeta("economy-news", {
            status: "error",
            lastError: String(error.message || error).slice(0, 500),
        });
    } finally {
        busy.news = false;
    }
}

async function startMarketEconomyJob() {
    if (started) return;
    started = true;
    if (!config.enabled) {
        console.log("[MARKET_ECONOMY] disabled (MARKET_ECONOMY_ENABLED!=true)");
        return;
    }
    console.log("[MARKET_ECONOMY] starting collectors", INSTANCE_ID, {
        news: config.newsEnabled,
    });
    setTimeout(() => {
        safeYields().catch(() => {});
        safeCalendar().catch(() => {});
        safeNews().catch(() => {});
    }, 2500);
    timers.push(setInterval(() => safeYields().catch(() => {}), config.yieldsPollMs));
    timers.push(setInterval(() => safeCalendar().catch(() => {}), config.calendarPollMs));
    if (config.newsEnabled) {
        timers.push(setInterval(() => safeNews().catch(() => {}), config.newsPollMs));
    }
    for (const t of timers) t.unref?.();
}

function stopMarketEconomyJob() {
    for (const t of timers) clearInterval(t);
    timers = [];
    started = false;
}

module.exports = {
    startMarketEconomyJob,
    stopMarketEconomyJob,
    safeYields,
    safeCalendar,
    safeNews,
};
