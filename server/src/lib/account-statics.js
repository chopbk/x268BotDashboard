const AccountStatic = require("../models/account-static");
const { PERMISSIONS } = require("../auth/access-control");
const { requireBot } = require("./bot-directory");
const { httpError } = require("./http");
const { openTimeFilter, openTimeRange } = require("./open-time-range");

const DETAIL_FIELDS = "env typeSignal symbol side entryPrice closePrice futuresLeverage costAmount positionAmt volume openTime closeTime status roe profit tps isCopy isLimit isPaper isClosed createdAt updatedAt";

function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function signalMatcher(value) {
    const name = String(value || "").trim();
    if (!name) return null;
    return new RegExp(`^${escapeRegex(name)}$`, "i");
}

function profitFilter(value) {
    const side = String(value || "").trim().toLowerCase();
    if (side === "win") return { $gt: 0 };
    if (side === "loss") return { $lt: 0 };
    if (side === "flat") return 0;
    return null;
}

function toStatic(row) {
    return {
        id: String(row._id),
        env: row.env,
        signal: row.typeSignal,
        symbol: row.symbol,
        side: row.side,
        entryPrice: row.entryPrice,
        closePrice: row.closePrice,
        leverage: row.futuresLeverage,
        cost: row.costAmount,
        positionAmt: row.positionAmt,
        volume: row.volume,
        openTime: row.openTime,
        closeTime: row.closeTime,
        status: row.status,
        roe: row.roe,
        profit: row.profit,
        tps: Array.isArray(row.tps) ? row.tps : [],
        copy: !!row.isCopy,
        limit: !!row.isLimit,
        paper: !!row.isPaper,
        closed: !!row.isClosed,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

function staticScope(input, envs, range) {
    const scope = { env: { $in: envs }, openTime: openTimeFilter(range) };
    if (["LONG", "SHORT"].includes(input.side)) scope.side = input.side;
    const q = String(input.q || "").trim();
    if (q) scope.symbol = new RegExp(escapeRegex(q), "i");
    const filter = { ...scope };
    const signalNames = String(input.signal || "").split(",").map((item) => item.trim()).filter(Boolean);
    if (signalNames.length === 1) {
        const matcher = signalMatcher(signalNames[0]);
        if (matcher) filter.typeSignal = matcher;
    } else if (signalNames.length > 1) {
        filter.$or = signalNames.map((name) => ({ typeSignal: signalMatcher(name) }));
    }
    const status = String(input.status || "").trim().toUpperCase();
    if (/^[A-Z0-9_]{1,16}$/.test(status)) filter.status = status;
    const profit = profitFilter(input.profit);
    if (profit !== null) filter.profit = profit;
    return { scope, filter };
}

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
    const { scope, filter } = staticScope(input, envs, range);

    const [rows, total, totals, breakdown] = await Promise.all([
        AccountStatic.find(filter).select(DETAIL_FIELDS).sort({ openTime: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        AccountStatic.countDocuments(filter),
        AccountStatic.aggregate([{ $match: filter }, { $group: { _id: null, profit: { $sum: { $ifNull: ["$profit", 0] } }, roi: { $sum: { $ifNull: ["$roe", 0] } }, volume: { $sum: { $ifNull: ["$volume", { $multiply: [{ $ifNull: ["$costAmount", 0] }, { $abs: { $ifNull: ["$futuresLeverage", 1] } }] }] } }, wins: { $sum: { $cond: [{ $eq: ["$status", "WIN"] }, 1, 0] } }, losses: { $sum: { $cond: [{ $eq: ["$status", "LOSS"] }, 1, 0] } } } }]),
        AccountStatic.aggregate([
            { $match: scope },
            {
                $facet: {
                    bySignal: [{
                        $group: {
                            _id: "$typeSignal",
                            count: { $sum: 1 },
                            profit: { $sum: { $ifNull: ["$profit", 0] } },
                            wins: { $sum: { $cond: [{ $eq: ["$status", "WIN"] }, 1, 0] } },
                            losses: { $sum: { $cond: [{ $eq: ["$status", "LOSS"] }, 1, 0] } },
                        },
                    }, { $sort: { count: -1 } }],
                    byStatus: [{ $group: { _id: "$status", count: { $sum: 1 }, profit: { $sum: { $ifNull: ["$profit", 0] } } } }],
                },
            },
        ]),
    ]);
    const sum = totals[0] || { profit: 0, roi: 0, volume: 0, wins: 0, losses: 0 };
    const facet = breakdown[0] || {};
    return {
        rows: rows.map(toStatic),
        stats: {
            total,
            wins: sum.wins,
            losses: sum.losses,
            winRate: total ? (sum.wins / total) * 100 : 0,
            profit: sum.profit,
            roi: sum.roi,
            volume: sum.volume,
            bySignal: (facet.bySignal || []).map((row) => ({
                signal: row._id || "UNKNOWN",
                count: row.count,
                wins: row.wins || 0,
                losses: row.losses || 0,
                winRate: row.count ? ((row.wins || 0) / row.count) * 100 : 0,
                profit: row.profit,
            })),
            byStatus: (facet.byStatus || []).map((row) => ({ status: row._id || "UNKNOWN", count: row.count, profit: row.profit })),
        },
        page, limit, total, username, env: env || null, envs, from: range.from, to: range.to,
    };
}

async function getAccountStatic(actor, id, input = {}) {
    const username = String(input.username || "").trim();
    if (!username) throw httpError(400, "Thiếu user bot");
    if (!/^[a-f0-9]{24}$/i.test(String(id || ""))) throw httpError(400, "Mã giao dịch không hợp lệ");
    const bot = await requireBot(actor, username, PERMISSIONS.STATISTICS_VIEW);
    const row = await AccountStatic.findOne({ _id: id, env: { $in: bot.accounts || [] } }).select(DETAIL_FIELDS).lean();
    if (!row) throw httpError(404, "Không tìm thấy giao dịch");
    return toStatic(row);
}

module.exports = { listAccountStatics, getAccountStatic };
