/**
 * Calendar schedule collector — schedule-only; no FRED-as-actual.
 */
const { fetchCalendarFeed, normalizeCalendarFeed } = require("../providers/calendar-ff");
const { resolveEventStatus } = require("../calendar-status");
const { upsertCalendarEvent, saveCalendarMeta, getContextSnapshot, saveContextSnapshot } = require("../store");
const { config } = require("../config");

async function collectCalendar() {
    const attemptAt = new Date();
    let body;
    let fetchError = null;
    try {
        body = await fetchCalendarFeed();
    } catch (error) {
        fetchError = String(error.message || error);
        console.warn("[MARKET_ECONOMY] calendar", fetchError);
        const meta = {
            updatedAt: attemptAt.toISOString(),
            ok: false,
            error: fetchError,
            coverage: {
                status: "unavailable",
                reasons: ["calendar_fetch_failed", fetchError],
                coverageFrom: null,
                coverageTo: null,
                source: config.calendarSource,
            },
        };
        await saveCalendarMeta(meta);
        return meta;
    }

    const normalized = normalizeCalendarFeed(body);
    let upserted = 0;
    for (const item of normalized.events) {
        const status = resolveEventStatus({
            scheduledAt: item.event.scheduledAt,
            timePrecision: item.event.timePrecision,
            hasTrustedActual: false,
            serverNow: attemptAt,
        });
        item.event.status = status;
        await upsertCalendarEvent(item);
        upserted += 1;
    }

    const meta = {
        updatedAt: attemptAt.toISOString(),
        ok: true,
        error: null,
        upserted,
        coverage: normalized.coverage,
        source: config.calendarSource,
    };
    await saveCalendarMeta(meta);

    const snap = (await getContextSnapshot()) || {};
    snap.calendarCoverage = normalized.coverage;
    snap.sourceHealth = {
        ...(snap.sourceHealth || {}),
        calendar: {
            ok: true,
            source: config.calendarSource,
            coverageTo: normalized.coverage.coverageTo,
            attribution: normalized.coverage.attribution,
            actualMode: "schedule_only",
        },
    };
    await saveContextSnapshot(snap);
    return meta;
}

module.exports = { collectCalendar };
