const RuntimeLog = require("../models/runtime-log");
const { PERMISSIONS, scopeForPermission } = require("../auth/access-control");
const { httpError } = require("./http");

const CATEGORIES = ["open", "exchange", "monitor", "tpsl", "listener", "mqtt", "signal", "process"];
const SYSTEM_CATEGORIES = ["listener", "mqtt", "process"];

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function listFilter(actor, input = {}) {
    const filters = [];
    const category = String(input.category || "").trim();
    if (CATEGORIES.includes(category)) filters.push({ category });
    const level = String(input.level || "").trim();
    if (["error", "warn", "info"].includes(level)) filters.push({ level });
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
        usernames: row.usernames || [],
        env: row.env || "",
        symbol: row.symbol || "",
        signal: row.signal || "",
        source: row.source || "",
        message: row.message || "",
    };
}

async function listRuntimeLogs(actor, input = {}) {
    if (!actor) throw httpError(401, "Chưa đăng nhập");
    const page = Math.max(1, Number.parseInt(input.page, 10) || 1);
    const limit = Math.min(100, Math.max(10, Number.parseInt(input.limit, 10) || 50));
    const filter = listFilter(actor, input);
    const [rows, total] = await Promise.all([
        RuntimeLog.find(filter).sort({ at: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        RuntimeLog.countDocuments(filter),
    ]);
    return {
        logs: rows.map(toRuntimeLog),
        page,
        limit,
        total,
        categories: CATEGORIES,
    };
}

module.exports = { CATEGORIES, SYSTEM_CATEGORIES, listFilter, listRuntimeLogs };
