/**
 * Redis latest snapshot + Mongo durable metrics/events for economy domain.
 */
const crypto = require("crypto");
const { getRedisClient } = require("../rate-limit-store");
const MarketEconomyMetric = require("../../models/market-economy-metric");
const MarketEconomyEvent = require("../../models/market-economy-event");
const MarketEconomyEventValue = require("../../models/market-economy-event-value");
const MarketEconomyCollectorState = require("../../models/market-economy-collector-state");

const memory = {
    context: null,
    calendarMeta: null,
};

function key(part) {
    return `wb:economy:${part}`;
}

async function redisSet(part, value, ttl = 600) {
    const client = getRedisClient();
    if (!client?.isReady) return;
    try {
        await client.set(key(part), JSON.stringify(value), { EX: ttl });
    } catch (error) {
        console.warn("[MARKET_ECONOMY] redis set", error.message || error);
    }
}

async function redisGet(part) {
    const client = getRedisClient();
    if (!client?.isReady) return null;
    try {
        const raw = await client.get(key(part));
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        console.warn("[MARKET_ECONOMY] redis get", error.message || error);
        return null;
    }
}

async function saveContextSnapshot(snapshot) {
    memory.context = snapshot;
    await redisSet("context", snapshot, 600);
}

async function getContextSnapshot() {
    if (memory.context) return memory.context;
    const cached = await redisGet("context");
    if (cached) memory.context = cached;
    return cached;
}

async function saveCalendarMeta(meta) {
    memory.calendarMeta = meta;
    await redisSet("calendarMeta", meta, 900);
}

async function getCalendarMeta() {
    if (memory.calendarMeta) return memory.calendarMeta;
    const cached = await redisGet("calendarMeta");
    if (cached) memory.calendarMeta = cached;
    return cached;
}

async function upsertMetricObservation(metric) {
    if (!metric?.id) return null;
    const observationPeriod = metric.observationDate || metric.sourceAsOf || "unknown";
    const doc = {
        metricId: metric.id,
        source: metric.source || "unknown",
        observationPeriod,
        vintageKey: "latest",
        value: metric.value,
        unit: metric.unit,
        displayValue: metric.displayValue || null,
        sourceSeriesId: metric.sourceSeriesId || null,
        sourceUrl: metric.sourceUrl || null,
        observationDate: metric.observationDate || null,
        referencePeriod: metric.referencePeriod || null,
        sourceAsOf: metric.sourceAsOf || null,
        observedAt: metric.observedAt ? new Date(metric.observedAt) : null,
        lastSuccessfulFetchAt: metric.lastSuccessfulFetchAt ? new Date(metric.lastSuccessfulFetchAt) : null,
        lastAttemptAt: metric.lastAttemptAt ? new Date(metric.lastAttemptAt) : null,
        frequency: metric.frequency || null,
        quality: metric.quality || "missing",
        marketState: metric.marketState || null,
        reason: metric.reason || null,
        previousValue: metric.previousValue ?? null,
        previousObservationDate: metric.previousObservationDate || null,
        deltaBp: metric.deltaBp ?? null,
        historical: false,
        payload: metric,
    };

    await MarketEconomyMetric.findOneAndUpdate(
        {
            metricId: doc.metricId,
            source: doc.source,
            observationPeriod: doc.observationPeriod,
            vintageKey: "latest",
        },
        { $set: doc },
        { upsert: true, new: true }
    );

    // Append revision row when value changes for same period (vintage = hash)
    if (metric.value != null && metric.observationDate) {
        const vintageKey = crypto
            .createHash("sha256")
            .update(`${metric.value}|${metric.observationDate}|${metric.source}`)
            .digest("hex")
            .slice(0, 16);
        await MarketEconomyMetric.updateOne(
            {
                metricId: doc.metricId,
                source: doc.source,
                observationPeriod: doc.observationPeriod,
                vintageKey,
            },
            {
                $setOnInsert: {
                    ...doc,
                    vintageKey,
                    historical: true,
                },
            },
            { upsert: true }
        );
    }
    return doc;
}

async function upsertCalendarEvent(normalized) {
    const ev = normalized.event;
    const existing = await MarketEconomyEvent.findOne({ eventId: ev.eventId }).lean();
    const scheduleChanged =
        existing &&
        ((existing.scheduledAt && new Date(existing.scheduledAt).toISOString()) !== ev.scheduledAt ||
            existing.status !== ev.status);

    const scheduleRevisions = existing?.scheduleRevisions ? [...existing.scheduleRevisions] : [];
    if (!existing) {
        scheduleRevisions.push({
            scheduledAt: ev.scheduledAt ? new Date(ev.scheduledAt) : null,
            scheduledDate: ev.scheduledDate,
            timePrecision: ev.timePrecision,
            status: ev.status,
            seenAt: new Date(),
            reason: "first_seen",
        });
    } else if (scheduleChanged) {
        scheduleRevisions.push({
            scheduledAt: ev.scheduledAt ? new Date(ev.scheduledAt) : null,
            scheduledDate: ev.scheduledDate,
            timePrecision: ev.timePrecision,
            status: ev.status,
            seenAt: new Date(),
            reason: "schedule_changed",
        });
    }

    await MarketEconomyEvent.findOneAndUpdate(
        { eventId: ev.eventId },
        {
            $set: {
                releaseGroupId: ev.releaseGroupId,
                metricKey: ev.metricKey,
                source: ev.source,
                sourceEventId: ev.sourceEventId,
                sourceUrl: ev.sourceUrl,
                country: ev.country,
                currency: ev.currency,
                title: ev.title,
                scheduledAt: ev.scheduledAt ? new Date(ev.scheduledAt) : null,
                scheduledDate: ev.scheduledDate,
                timePrecision: ev.timePrecision,
                impact: ev.impact,
                referencePeriod: ev.referencePeriod,
                status: ev.status,
                coverage: ev.coverage,
                scheduleRevisions,
                lastSeenAt: new Date(),
            },
            $setOnInsert: { eventId: ev.eventId },
        },
        { upsert: true }
    );

    for (const v of normalized.values || []) {
        const vintageKey = crypto
            .createHash("sha256")
            .update(`${v.field}|${v.displayValue || ""}|${v.numericValue ?? ""}|${ev.referencePeriod || ""}`)
            .digest("hex")
            .slice(0, 16);
        const existingVal = await MarketEconomyEventValue.findOne({
            eventId: ev.eventId,
            field: v.field,
            vintageKey,
        }).lean();
        if (existingVal) continue;
        // Only insert new vintage when value changed vs latest for field
        const latest = await MarketEconomyEventValue.findOne({ eventId: ev.eventId, field: v.field })
            .sort({ firstSeenAt: -1 })
            .lean();
        if (
            latest &&
            latest.displayValue === v.displayValue &&
            latest.numericValue === v.numericValue
        ) {
            continue;
        }
        await MarketEconomyEventValue.create({
            eventId: ev.eventId,
            field: v.field,
            vintageKey,
            numericValue: v.numericValue,
            displayValue: v.displayValue,
            unit: v.unit || null,
            scale: v.scale || null,
            adjustment: v.adjustment || null,
            period: v.period || ev.referencePeriod || null,
            source: v.source || ev.source,
            knownAt: new Date(),
            firstSeenAt: new Date(),
            knownBeforeRelease: v.knownBeforeRelease,
            isTrustedActual: Boolean(v.isTrustedActual),
            kind: v.kind || "provider",
        });
    }

    return ev.eventId;
}

async function listEventsInRange({ from, to, currencies, impacts, limit = 50, cursor } = {}) {
    const q = {};
    if (from || to) {
        q.scheduledAt = {};
        if (from) q.scheduledAt.$gte = new Date(from);
        if (to) q.scheduledAt.$lt = new Date(to);
    }
    if (currencies?.length) q.currency = { $in: currencies };
    if (impacts?.length) q.impact = { $in: impacts };
    if (cursor) {
        const c = new Date(cursor);
        if (Number.isFinite(c.getTime())) {
            q.scheduledAt = { ...(q.scheduledAt || {}), $gt: c };
        }
    }

    const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const rows = await MarketEconomyEvent.find(q).sort({ scheduledAt: 1, eventId: 1 }).limit(lim + 1).lean();
    const hasMore = rows.length > lim;
    const page = hasMore ? rows.slice(0, lim) : rows;
    const nextCursor = hasMore ? page[page.length - 1].scheduledAt?.toISOString() : null;
    return { events: page, nextCursor, count: page.length };
}

async function getEventById(eventId) {
    return MarketEconomyEvent.findOne({ eventId }).lean();
}

async function listEventValues(eventId, { field, limit = 50 } = {}) {
    const q = { eventId };
    if (field) q.field = field;
    return MarketEconomyEventValue.find(q).sort({ firstSeenAt: -1 }).limit(Math.min(limit, 100)).lean();
}

async function listMetricSeries(metricId, { fromDate, limit = 90 } = {}) {
    const q = { metricId, historical: true };
    if (fromDate) q.observationDate = { $gte: fromDate };
    return MarketEconomyMetric.find(q)
        .sort({ observationDate: 1 })
        .limit(Math.min(limit, 500))
        .lean();
}

async function getLatestMetrics(metricIds) {
    const out = {};
    await Promise.all(
        metricIds.map(async (id) => {
            const row = await MarketEconomyMetric.findOne({ metricId: id, vintageKey: "latest" })
                .sort({ updatedAt: -1 })
                .lean();
            if (row) out[id] = row;
        })
    );
    return out;
}

async function saveCollectorMeta(taskId, patch) {
    await MarketEconomyCollectorState.findByIdAndUpdate(
        taskId,
        { $set: { ...patch, updatedAt: new Date() } },
        { upsert: true }
    );
}

module.exports = {
    saveContextSnapshot,
    getContextSnapshot,
    saveCalendarMeta,
    getCalendarMeta,
    upsertMetricObservation,
    upsertCalendarEvent,
    listEventsInRange,
    getEventById,
    listEventValues,
    listMetricSeries,
    getLatestMetrics,
    saveCollectorMeta,
    MarketEconomyCollectorState,
};
