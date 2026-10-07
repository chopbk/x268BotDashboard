const AccountStatic = require("../models/account-static");
const { PERMISSIONS } = require("../auth/access-control");
const { requireBot } = require("./bot-directory");
const { httpError } = require("./http");
const { openTimeFilter, openTimeRange } = require("./open-time-range");

function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

async function listAccountStatics(actor, input = {}) {
    const username = String(input.username || "").trim();
    const env = String(input.env || "").trim();
    if (!username) throw httpError(400, "Thiếu user bot");
    const bot = await requireBot(actor, username, PERMISSIONS.STATISTICS_VIEW);
    const envs = env ? [env] : (bot.accounts || []);
    if (env && !(bot.accounts || []).includes(env)) throw httpError(404, "Config không thuộc user bot này");
    const page = Math.max(1, Number.parseInt(input.page, 10) || 1);
    const limit = Math.min(100, Math.max(10, Number.parseInt(input.limit, 10) || 50));
    const range = openTimeRange(input);
    const filter = { env: { $in: envs }, openTime: openTimeFilter(range) };
    if (["LONG", "SHORT"].includes(input.side)) filter.side = input.side;
    const q = String(input.q || "").trim();
    if (q) filter.symbol = new RegExp(escapeRegex(q), "i");

    const [rows, total, totals, bySignal] = await Promise.all([
        AccountStatic.find(filter).select("env typeSignal symbol side entryPrice closePrice leverage futuresLeverage costAmount volume openTime closeTime status roe profit isCopy isPaper isClosed").sort({ openTime: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        AccountStatic.countDocuments(filter),
        AccountStatic.aggregate([{ $match: filter }, { $group: { _id: null, profit: { $sum: { $ifNull: ["$profit", 0] } }, roi: { $sum: { $ifNull: ["$roe", 0] } }, volume: { $sum: { $ifNull: ["$volume", { $multiply: [{ $ifNull: ["$costAmount", 0] }, { $abs: { $ifNull: ["$futuresLeverage", 1] } }] }] } }, wins: { $sum: { $cond: [{ $eq: ["$status", "WIN"] }, 1, 0] } }, losses: { $sum: { $cond: [{ $eq: ["$status", "LOSS"] }, 1, 0] } } } }]),
        AccountStatic.aggregate([{ $match: filter }, { $group: { _id: "$typeSignal", count: { $sum: 1 }, profit: { $sum: { $ifNull: ["$profit", 0] } } } }, { $sort: { count: -1 } }]),
    ]);
    const sum = totals[0] || { profit: 0, roi: 0, volume: 0, wins: 0, losses: 0 };
    return {
        rows: rows.map((row) => ({ id: String(row._id), env: row.env, signal: row.typeSignal, symbol: row.symbol, side: row.side, entryPrice: row.entryPrice, closePrice: row.closePrice, leverage: row.futuresLeverage, cost: row.costAmount, volume: row.volume, openTime: row.openTime, closeTime: row.closeTime, status: row.status, roe: row.roe, profit: row.profit, copy: !!row.isCopy, paper: !!row.isPaper, closed: !!row.isClosed })),
        stats: { total, wins: sum.wins, losses: sum.losses, winRate: total ? (sum.wins / total) * 100 : 0, profit: sum.profit, roi: sum.roi, volume: sum.volume, bySignal: bySignal.map((row) => ({ signal: row._id || "UNKNOWN", count: row.count, profit: row.profit })) },
        page, limit, total, username, env: env || null, envs, from: range.from, to: range.to,
    };
}

module.exports = { listAccountStatics };
