const AccountConfig = require("../models/account-config");
const SignalInfo = require("../models/signal-info");
const { PERMISSIONS } = require("../auth/access-control");
const { requireBot } = require("./bot-directory");
const { httpError } = require("./http");
const { openTimeFilter, openTimeRange } = require("./open-time-range");

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function signalNamesForBot(actor, username, env) {
    const bot = await requireBot(actor, username, PERMISSIONS.SIGNALS_HISTORY);
    const envs = env ? [env] : (bot.accounts || []);
    if (env && !(bot.accounts || []).includes(env)) throw httpError(404, "Config không thuộc user bot này");
    const configs = await AccountConfig.find({ env: { $in: envs } }).select("env signals").lean();
    const names = [...new Set(configs.flatMap((row) => row.signals || []).filter(Boolean))];
    return { names, envs };
}

async function listSignalHistory(actor, input = {}) {
    const username = String(input.username || "").trim();
    const env = String(input.env || "").trim();
    if (!username) throw httpError(400, "Thiếu user bot");
    const { names, envs } = await signalNamesForBot(actor, username, env || null);
    const page = Math.max(1, Number.parseInt(input.page, 10) || 1);
    const limit = Math.min(100, Math.max(10, Number.parseInt(input.limit, 10) || 50));
    const range = openTimeRange(input);
    if (!names.length) {
        return { rows: [], stats: { total: 0, long: 0, short: 0, bySignal: [] }, page, limit, total: 0, username, env: env || null, envs, signals: [], from: range.from, to: range.to };
    }

    const signalVariants = [...new Set(names.flatMap((name) => [name, String(name).toUpperCase(), String(name).toLowerCase()]))];
    const filter = { signal: { $in: signalVariants } };
    filter.openTime = openTimeFilter(range);
    if (["LONG", "SHORT"].includes(input.side)) filter.side = input.side;
    const query = String(input.q || "").trim();
    if (query) filter.symbol = new RegExp(escapeRegex(query), "i");

    const [rows, total, grouped] = await Promise.all([
        SignalInfo.find(filter).select("signal status side symbol type openTime createdAt").sort({ openTime: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        SignalInfo.countDocuments(filter),
        SignalInfo.aggregate([{ $match: filter }, { $group: { _id: { signal: "$signal", side: "$side" }, count: { $sum: 1 } } }]),
    ]);
    const bySignalMap = new Map();
    let long = 0;
    let short = 0;
    for (const item of grouped) {
        const count = item.count || 0;
        const signal = item._id?.signal || "UNKNOWN";
        bySignalMap.set(signal, (bySignalMap.get(signal) || 0) + count);
        if (item._id?.side === "LONG") long += count;
        if (item._id?.side === "SHORT") short += count;
    }
    return {
        rows: rows.map((row) => ({ id: String(row._id), signal: row.signal, status: row.status, side: row.side, symbol: row.symbol, type: row.type, openTime: row.openTime, createdAt: row.createdAt })),
        stats: { total, long, short, bySignal: [...bySignalMap].map(([signal, count]) => ({ signal, count })).sort((a, b) => b.count - a.count) },
        page, limit, total, username, env: env || null, envs, signals: names, from: range.from, to: range.to,
    };
}

module.exports = { signalNamesForBot, listSignalHistory };
