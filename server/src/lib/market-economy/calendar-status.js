/**
 * Economic calendar event status machine (server decides due/released).
 */

const STATUSES = Object.freeze([
    "scheduled",
    "due",
    "released",
    "postponed",
    "cancelled",
    "unknown",
]);

/**
 * @param {{
 *   scheduledAt?: string|Date|null,
 *   timePrecision?: string,
 *   status?: string,
 *   hasTrustedActual?: boolean,
 *   serverNow?: Date,
 * }} input
 */
function resolveEventStatus(input = {}) {
    const now = input.serverNow instanceof Date ? input.serverNow : new Date();
    const forced = input.status;
    if (forced === "cancelled" || forced === "postponed" || forced === "unknown") {
        return forced;
    }
    if (input.hasTrustedActual) return "released";

    const precision = input.timePrecision || "datetime";
    if (precision === "date" || precision === "tentative") {
        if (forced === "released") return "released";
        return forced === "due" ? "due" : "scheduled";
    }

    if (!input.scheduledAt) return "unknown";
    const t = new Date(input.scheduledAt).getTime();
    if (!Number.isFinite(t)) return "unknown";
    if (now.getTime() >= t) return "due";
    return "scheduled";
}

/**
 * Countdown only when timePrecision=datetime and scheduledAt known.
 * @returns {{ countdownMs: number|null, badge: string|null }}
 */
function countdownInfo(scheduledAt, serverNow = new Date(), timePrecision = "datetime") {
    if (timePrecision !== "datetime" || !scheduledAt) {
        return { countdownMs: null, badge: null };
    }
    const t = new Date(scheduledAt).getTime();
    if (!Number.isFinite(t)) return { countdownMs: null, badge: null };
    const ms = t - serverNow.getTime();
    let badge = null;
    if (ms > 0 && ms <= 15 * 60_000) badge = "Trong 15 phút";
    else if (ms > 0 && ms <= 60 * 60_000) badge = "Trong 60 phút";
    return { countdownMs: ms, badge };
}

function isValidIanaTimeZone(tz) {
    if (!tz || typeof tz !== "string") return false;
    try {
        Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
        return true;
    } catch {
        return false;
    }
}

function normalizeTimeZone(tz, fallback = "Asia/Ho_Chi_Minh") {
    return isValidIanaTimeZone(tz) ? tz : fallback;
}

/** Format instant in IANA zone (no fixed offset). */
function formatInTimeZone(isoOrDate, timeZone, options = {}) {
    const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
    if (!Number.isFinite(d.getTime())) return null;
    const tz = normalizeTimeZone(timeZone);
    const fmt = new Intl.DateTimeFormat("vi-VN", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: options.dateOnly ? undefined : "2-digit",
        minute: options.dateOnly ? undefined : "2-digit",
        second: options.dateOnly ? undefined : undefined,
        hour12: false,
        ...options.intl,
    });
    return fmt.format(d);
}

/** Calendar day YYYY-MM-DD in zone. */
function calendarDateInZone(isoOrDate, timeZone) {
    const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
    if (!Number.isFinite(d.getTime())) return null;
    const tz = normalizeTimeZone(timeZone);
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(d);
    const y = parts.find((p) => p.type === "year")?.value;
    const m = parts.find((p) => p.type === "month")?.value;
    const day = parts.find((p) => p.type === "day")?.value;
    if (!y || !m || !day) return null;
    return `${y}-${m}-${day}`;
}

/**
 * Start/end UTC for a local calendar day in zone (handles DST).
 */
function localDayUtcRange(yyyyMmDd, timeZone) {
    const tz = normalizeTimeZone(timeZone);
    const [y, mo, da] = String(yyyyMmDd).split("-").map((x) => Number(x));
    if (![y, mo, da].every(Number.isFinite)) return null;

    // Binary search / probe: find UTC instants that format to the day in zone.
    const approx = Date.UTC(y, mo - 1, da, 12, 0, 0);
    let start = null;
    let end = null;
    for (let offsetH = -36; offsetH <= 36; offsetH++) {
        const t = new Date(approx + offsetH * 3600_000);
        if (calendarDateInZone(t, tz) === yyyyMmDd) {
            if (start == null) start = t;
            end = new Date(t.getTime() + 3600_000);
        } else if (start != null) {
            break;
        }
    }
    if (!start || !end) return null;
    // Refine start to first ms of the day
    let lo = start.getTime() - 3600_000;
    let hi = start.getTime() + 3600_000;
    while (hi - lo > 1000) {
        const mid = Math.floor((lo + hi) / 2);
        if (calendarDateInZone(new Date(mid), tz) === yyyyMmDd) hi = mid;
        else lo = mid;
    }
    const dayStart = new Date(hi);
    lo = dayStart.getTime();
    hi = dayStart.getTime() + 48 * 3600_000;
    while (hi - lo > 1000) {
        const mid = Math.floor((lo + hi) / 2);
        if (calendarDateInZone(new Date(mid), tz) === yyyyMmDd) lo = mid;
        else hi = mid;
    }
    const dayEndExclusive = new Date(hi);
    return { from: dayStart.toISOString(), to: dayEndExclusive.toISOString() };
}

module.exports = {
    STATUSES,
    resolveEventStatus,
    countdownInfo,
    isValidIanaTimeZone,
    normalizeTimeZone,
    formatInTimeZone,
    calendarDateInZone,
    localDayUtcRange,
};
