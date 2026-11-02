const RuntimeLog = require("../models/runtime-log");
const { PERMISSIONS, scopeForPermission } = require("../auth/access-control");
const { httpError } = require("./http");
const {
    resolveHistogramWindow,
    bucketKey,
    shapeHistogramPoints,
} = require("./runtime-histogram");

const CATEGORIES = ["open", "exchange", "monitor", "tpsl", "listener", "mqtt", "signal", "process"];
const SYSTEM_CATEGORIES = ["listener", "mqtt", "process"];

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function listFilter(actor, input = {}, { includeLevel = true } = {}) {
    const filters = [];
    const category = String(input.category || "").trim();
    if (CATEGORIES.includes(category)) filters.push({ category });
    if (includeLevel) {
        const level = String(input.level || "").trim();
        if (["error", "warn", "info"].includes(level)) filters.push({ level });
    }
    const at = {};
    const from = input.from ? new Date(input.from) : null;
    const to = input.to ? new Date(input.to) : null;
    if (from && !Number.isNaN(from.getTime())) at.$gte = from;
    if (to && !Number.isNaN(to.getTime())) at.$lte = to;
    if (Object.keys(at).length) filters.push({ at });
    const query = String(input.q || "").trim();
    if (query) {
        const pattern = new RegExp(escapeRegex(query), "i");
        filters.push({ $or: [
            { message: pattern },
            { env: pattern },
            { symbol: pattern },
            { signal: pattern },
            { source: pattern },
            { processName: pattern },
        ] });
    }
    const scope = scopeForPermission(actor, PERMISSIONS.LOGS_VIEW);
    if (scope !== "all") {
        const names = actor.botUsernames || [];
        filters.push({ category: { $nin: SYSTEM_CATEGORIES } });
        filters.push({ usernames: { $in: names } });
    }
    if (filters.length > 1) return { $and: filters };
    return filters[0] || {};
}

function toRuntimeLog(row) {
    return {
        id: String(row._id),
        at: row.at,
        level: row.level,
        category: row.category,
        role: row.role || "",
        processName: row.processName || "",
        pmId: row.pmId || "",
        host: row.host || "",
        usernames: row.usernames || [],
        env: row.env || "",
        symbol: row.symbol || "",
        signal: row.signal || "",
        source: row.source || "",
        message: row.message || "",
    };
}

async function aggregateRuntimeHistogram(actor, input = {}) {
    if (!actor) throw httpError(401, "Chưa đăng nhập");
    const window = resolveHistogramWindow(input);
    const filterInput = {
        category: input.category,
        q: input.q,
        from: window.from.toISOString(),
        to: window.to.toISOString(),
    };
    // Chart nền: không cắt theo level (selection level chỉ lọc bảng).
    const filter = listFilter(actor, filterInput, { includeLevel: false });
    const format = window.bucket === "hour" ? "%Y-%m-%dT%H:00:00.000Z" : "%Y-%m-%d";
    let rows = [];
    if (typeof RuntimeLog.aggregate === "function") {
        rows = await RuntimeLog.aggregate([
            { $match: filter },
            {
                $group: {
                    _id: {
                        bucket: { $dateToString: { format, date: "$at", timezone: "UTC" } },
                        level: "$level",
                    },
                    count: { $sum: 1 },
                },
            },
        ]);
        rows = (rows || []).map((row) => ({
            t: row._id?.bucket,
            level: row._id?.level,
            count: row.count,
        }));
    }
    return shapeHistogramPoints(rows, window);
}

/**
 * bucketFrom/bucketTo: selection chart lọc bảng, không đổi histogram nền.
 * from/to: kỳ nền (UI mặc định 24h nếu trống).
 */
async function listRuntimeLogs(actor, input = {}) {
    if (!actor) throw httpError(401, "Chưa đăng nhập");
    const page = Math.max(1, Number.parseInt(input.page, 10) || 1);
    const limit = Math.min(100, Math.max(10, Number.parseInt(input.limit, 10) || 50));
    const wantHistogram = String(input.histogram || "1") !== "0";
    const baseWindow = resolveHistogramWindow({ from: input.from, to: input.to });
    const listInput = {
        ...input,
        from: input.bucketFrom || input.from || (wantHistogram ? baseWindow.from.toISOString() : undefined),
        to: input.bucketTo || input.to || (wantHistogram ? baseWindow.to.toISOString() : undefined),
    };
    const filter = listFilter(actor, listInput);
    const [rows, total, histogram] = await Promise.all([
        RuntimeLog.find(filter).sort({ at: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        RuntimeLog.countDocuments(filter),
        wantHistogram
            ? aggregateRuntimeHistogram(actor, {
                category: input.category,
                q: input.q,
                from: input.from || baseWindow.from.toISOString(),
                to: input.to || baseWindow.to.toISOString(),
            })
            : null,
    ]);
    return {
        logs: rows.map(toRuntimeLog),
        page,
        limit,
        total,
        categories: CATEGORIES,
        from: input.from || (wantHistogram ? baseWindow.from.toISOString() : null),
        to: input.to || (wantHistogram ? baseWindow.to.toISOString() : null),
        histogram,
    };
}

module.exports = {
    CATEGORIES,
    SYSTEM_CATEGORIES,
    listFilter,
    listRuntimeLogs,
    aggregateRuntimeHistogram,
    resolveHistogramWindow,
    bucketKey,
    shapeHistogramPoints,
};
