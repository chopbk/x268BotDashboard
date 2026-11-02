/** Pure helpers cho histogram runtime logs — test không cần Mongo. */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MAX_SPAN_MS = 90 * DAY_MS;

function validDate(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Kỳ histogram: mặc định 24h; tối đa 90 ngày.
 * <=48h → bucket giờ; dài hơn → ngày. UTC.
 */
function resolveHistogramWindow(input = {}, now = new Date()) {
    const end = validDate(input.to) || now;
    let start = validDate(input.from);
    if (!start) start = new Date(end.getTime() - 24 * HOUR_MS);
    if (end.getTime() < start.getTime()) {
        return resolveHistogramWindow({ from: end, to: start }, now);
    }
    let from = start;
    let to = end;
    if (to.getTime() - from.getTime() > MAX_SPAN_MS) {
        from = new Date(to.getTime() - MAX_SPAN_MS);
    }
    const span = to.getTime() - from.getTime();
    const bucket = span <= 48 * HOUR_MS ? "hour" : "day";
    return {
        from,
        to,
        bucket,
        timezone: "UTC",
        defaulted: !validDate(input.from),
    };
}

function bucketKey(date, bucket) {
    const d = validDate(date);
    if (!d) return null;
    if (bucket === "hour") {
        return new Date(Date.UTC(
            d.getUTCFullYear(),
            d.getUTCMonth(),
            d.getUTCDate(),
            d.getUTCHours(),
            0,
            0,
            0
        )).toISOString();
    }
    return d.toISOString().slice(0, 10);
}

function enumerateBuckets(from, to, bucket) {
    const keys = [];
    if (bucket === "hour") {
        const start = new Date(Date.UTC(
            from.getUTCFullYear(),
            from.getUTCMonth(),
            from.getUTCDate(),
            from.getUTCHours(),
            0,
            0,
            0
        ));
        for (let t = start.getTime(); t <= to.getTime(); t += HOUR_MS) {
            keys.push(new Date(t).toISOString());
        }
    } else {
        const start = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
        const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
        for (let t = start.getTime(); t <= end.getTime(); t += DAY_MS) {
            keys.push(new Date(t).toISOString().slice(0, 10));
        }
    }
    return keys;
}

/**
 * rows: [{ t|bucket, level, count }]
 * Trả points đầy đủ gap = 0.
 */
function shapeHistogramPoints(rows, window) {
    const byKey = new Map();
    for (const key of enumerateBuckets(window.from, window.to, window.bucket)) {
        byKey.set(key, { t: key, error: 0, warn: 0, info: 0, total: 0 });
    }
    for (const row of rows || []) {
        const rawT = row.t || row.bucket || row._id?.bucket || row._id;
        const level = String(row.level || row._id?.level || "").toLowerCase();
        const count = Number(row.count) || 0;
        const key = typeof rawT === "string" ? rawT : bucketKey(rawT, window.bucket);
        if (!key || !byKey.has(key)) continue;
        const point = byKey.get(key);
        if (level === "error" || level === "warn" || level === "info") {
            point[level] += count;
            point.total += count;
        }
    }
    const points = [...byKey.values()];
    const total = points.reduce((sum, row) => sum + row.total, 0);
    return {
        points,
        total,
        bucket: window.bucket,
        from: window.from.toISOString(),
        to: window.to.toISOString(),
        timezone: "UTC",
        defaulted: window.defaulted === true,
        metric: "log_count",
        note: "Số log đã ghi nhận — không phải số sự cố độc lập hoặc uptime",
    };
}

module.exports = {
    HOUR_MS,
    DAY_MS,
    MAX_SPAN_MS,
    resolveHistogramWindow,
    bucketKey,
    enumerateBuckets,
    shapeHistogramPoints,
};
