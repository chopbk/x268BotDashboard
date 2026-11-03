/**
 * Economic calendar schedule adapter — Faireconomy this-week JSON (FF-shaped).
 * Spike 2026-11-03:
 * - Schema: title, country, date (offset ISO), impact, forecast, previous — no actual, no stable id.
 * - Coverage: current week only; nextweek URL 404 → coverage partial for “7 ngày tới”.
 * - Terms: unofficial redistributor; operator must verify redistribution rights before enabling production.
 * - Actual: schedule-only — do NOT map FRED series as release actual.
 */
const crypto = require("crypto");
const { config } = require("../config");
const { parseDisplayNumber } = require("../units");

const IMPACT_MAP = Object.freeze({
    High: "high",
    Medium: "medium",
    Low: "low",
    Holiday: "holiday",
});

function stableSourceEventId(row) {
    const raw = [row.title, row.country, row.date, row.impact].map((x) => String(x || "")).join("|");
    return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

function canonicalEventId(source, sourceEventId, metricKey = "headline") {
    const raw = `${source}:${sourceEventId}:${metricKey}`;
    return `econ_${crypto.createHash("sha256").update(raw).digest("hex").slice(0, 20)}`;
}

async function fetchCalendarFeed(url = config.calendarFeedUrl, timeoutMs = config.providerTimeoutMs) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            signal: ctrl.signal,
            headers: { accept: "application/json", "user-agent": "web-bot-economy/1.0" },
        });
        if (!res.ok) {
            const err = new Error(`calendar ${res.status}`);
            err.status = res.status;
            err.retryAfter = res.headers.get("retry-after");
            throw err;
        }
        return await res.json();
    } finally {
        clearTimeout(t);
    }
}

function normalizeImpact(raw) {
    return IMPACT_MAP[raw] || "unknown";
}

/**
 * Parse one feed row into event + optional forecast/previous value records (not trusted actual).
 */
function normalizeCalendarRow(row, source = config.calendarSource) {
    if (!row?.title || !row?.date) return null;
    const sourceEventId = stableSourceEventId(row);
    const metricKey = "headline";
    const eventId = canonicalEventId(source, sourceEventId, metricKey);
    const scheduledAt = new Date(row.date);
    if (!Number.isFinite(scheduledAt.getTime())) return null;

    const currency = String(row.country || "").toUpperCase() || null;
    const impact = normalizeImpact(row.impact);
    const timePrecision = "datetime";

    const values = [];
    const forecastDisplay = row.forecast != null && String(row.forecast).trim() !== "" ? String(row.forecast).trim() : null;
    const previousDisplay = row.previous != null && String(row.previous).trim() !== "" ? String(row.previous).trim() : null;

    if (forecastDisplay) {
        values.push({
            field: "forecast",
            displayValue: forecastDisplay,
            numericValue: parseDisplayNumber(forecastDisplay),
            source,
            knownBeforeRelease: null,
            isTrustedActual: false,
        });
    }
    if (previousDisplay) {
        values.push({
            field: "previous",
            displayValue: previousDisplay,
            numericValue: parseDisplayNumber(previousDisplay),
            source,
            knownBeforeRelease: null,
            isTrustedActual: false,
        });
    }
    // No actual field in feed — schedule-only; never invent actual from FRED.

    return {
        event: {
            eventId,
            releaseGroupId: eventId,
            metricKey,
            source,
            sourceEventId,
            sourceUrl: null,
            country: currency,
            currency,
            title: String(row.title),
            scheduledAt: scheduledAt.toISOString(),
            scheduledDate: scheduledAt.toISOString().slice(0, 10),
            timePrecision,
            impact,
            referencePeriod: null,
            status: "scheduled",
            coverage: "partial",
        },
        values,
    };
}

function normalizeCalendarFeed(body, source = config.calendarSource) {
    const list = Array.isArray(body) ? body : [];
    const events = [];
    const seen = new Set();
    let minAt = null;
    let maxAt = null;
    for (const row of list) {
        const n = normalizeCalendarRow(row, source);
        if (!n) continue;
        if (seen.has(n.event.eventId)) continue;
        seen.add(n.event.eventId);
        events.push(n);
        const t = new Date(n.event.scheduledAt).getTime();
        if (!minAt || t < minAt) minAt = t;
        if (!maxAt || t > maxAt) maxAt = t;
    }
    return {
        events,
        coverage: {
            status: events.length ? "partial" : "unavailable",
            reasons: [
                "calendar_this_week_only",
                "actual_not_provided_by_feed",
                "terms_unverified_redistributor",
            ],
            coverageFrom: minAt ? new Date(minAt).toISOString() : null,
            coverageTo: maxAt ? new Date(maxAt).toISOString() : null,
            source,
            attribution: "Schedule feed shaped like Forex Factory via faireconomy media; not an official FF API.",
        },
    };
}

module.exports = {
    fetchCalendarFeed,
    normalizeCalendarRow,
    normalizeCalendarFeed,
    stableSourceEventId,
    canonicalEventId,
};
