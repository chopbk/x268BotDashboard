/**
 * Phát hiện bất thường — rolling z-score khi đủ mẫu; không spam warm-up.
 */
const SmartMoneyEvent = require("../../models/smart-money-event");
const { getHistory } = require("./store");
const { config } = require("./config");
const { finite, zScore, deltaPct } = require("./formulas");

function pickSeries(rows, getter) {
    const out = [];
    for (const row of rows) {
        const snap = row.snapshot || row;
        if (snap.quality?.stale) continue;
        if (snap.quality?.overall === "source_error") continue;
        const v = getter(snap);
        if (v != null) out.push(v);
    }
    return out;
}

function eventDedupeKey(symbol, type, direction, hourBucket) {
    return `${symbol}|${type}|${direction || "-"}|${hourBucket}`;
}

async function maybeEmit(event) {
    const hourBucket = Math.floor(Date.now() / config.eventCooldownMs);
    const dedupeKey = eventDedupeKey(event.symbol, event.type, event.direction, hourBucket);
    try {
        await SmartMoneyEvent.updateOne(
            { dedupeKey },
            {
                $setOnInsert: {
                    ...event,
                    dedupeKey,
                    at: new Date(event.at || Date.now()),
                    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                },
            },
            { upsert: true }
        );
        return true;
    } catch (error) {
        if (error?.code === 11000) return false;
        throw error;
    }
}

async function detectForSymbol(symbol, latest) {
    if (!latest || latest.quality?.overall === "warming") {
        return { events: [], warming: true, sampleProgress: 0 };
    }

    const history = await getHistory(symbol, { limit: 48 });
    const chronological = [...history].reverse();
    const events = [];

    const checks = [
        {
            type: "sm_whale_long_qty",
            direction: "up",
            getter: (s) => finite(s.smartMoney?.whales?.longQty),
            requireComparable: true,
        },
        {
            type: "sm_whale_long_qty",
            direction: "down",
            getter: (s) => finite(s.smartMoney?.whales?.longQty),
            requireComparable: true,
            invert: true,
        },
        {
            type: "sm_whale_short_qty",
            direction: "up",
            getter: (s) => finite(s.smartMoney?.whales?.shortQty),
            requireComparable: true,
        },
        {
            type: "oi_qty",
            direction: "up",
            getter: (s) => finite(s.openInterest?.qty),
        },
        {
            type: "taker_bsr",
            direction: "skew",
            getter: (s) => finite(s.taker?.buySellRatio),
        },
        {
            type: "funding_rate",
            direction: "extreme",
            getter: (s) => finite(s.funding?.currentRate),
        },
    ];

    let maxSamples = 0;
    for (const check of checks) {
        if (check.requireComparable && latest.smartMoney?.comparable === false) continue;
        const series = pickSeries(chronological, check.getter);
        maxSamples = Math.max(maxSamples, series.length);
        if (series.length < config.minSamplesForZ) continue;

        const current = check.getter(latest);
        if (current == null) continue;
        const prior = series.slice(0, -1);
        if (prior.length < config.minSamplesForZ - 1) continue;

        const z = zScore(current, prior);
        if (z == null) continue;
        const absZ = Math.abs(z);
        if (absZ < config.zScoreThreshold) continue;

        // Ngưỡng biến động tối thiểu so với median gần
        const lastPrior = prior[prior.length - 1];
        const pct = deltaPct(current, lastPrior);
        if (pct != null && Math.abs(pct) < config.minAbsDeltaPct && check.type !== "funding_rate") continue;

        const direction =
            check.direction === "skew" || check.direction === "extreme"
                ? z >= 0
                    ? "high"
                    : "low"
                : z >= 0
                  ? "up"
                  : "down";

        if (check.invert && direction === "up") continue;
        if (check.direction === "up" && direction !== "up") continue;
        if (check.direction === "down" && direction !== "down") continue;

        const smallSample = prior.length < config.minSamplesForZ + 6;
        const payload = {
            symbol: String(symbol).toUpperCase(),
            type: check.type,
            direction,
            window: `${prior.length}_samples`,
            before: lastPrior,
            after: current,
            zScore: Math.round(z * 100) / 100,
            threshold: config.zScoreThreshold,
            sampleSize: prior.length,
            quality: latest.quality?.overall || null,
            smallSample,
            message: smallSample
                ? `Mẫu còn nhỏ (n=${prior.length}) — cảnh báo tham khảo`
                : `${check.type} z=${z.toFixed(2)}`,
        };
        const inserted = await maybeEmit(payload);
        if (inserted) events.push(payload);
    }

    const warming = maxSamples < config.minSamplesForZ;
    return {
        events,
        warming,
        sampleProgress: Math.min(1, maxSamples / config.minSamplesForZ),
    };
}

async function listEvents({ symbol, limit = 50, from } = {}) {
    const q = {};
    if (symbol) q.symbol = String(symbol).toUpperCase();
    if (from) q.at = { $gte: new Date(from) };
    const lim = Math.min(config.eventLimitMax, Math.max(1, Number(limit) || 50));
    return SmartMoneyEvent.find(q).sort({ at: -1 }).limit(lim).lean();
}

module.exports = { detectForSymbol, listEvents, pickSeries };
