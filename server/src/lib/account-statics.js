const AccountStatic = require("../models/account-static");
const AccountConfig = require("../models/account-config");
const { PERMISSIONS } = require("../auth/access-control");
const { requireBot } = require("./bot-directory");
const { httpError } = require("./http");
const { openTimeFilter, openTimeRange } = require("./open-time-range");
const { findSymbolInfo } = require("./symbol-info");

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

const volumeExpr = {
    $ifNull: ["$volume", { $multiply: [{ $ifNull: ["$costAmount", 0] }, { $abs: { $ifNull: ["$futuresLeverage", 1] } }] }],
};
const profitExpr = { $ifNull: ["$profit", 0] };
const winCond = { $eq: ["$status", "WIN"] };
const lossCond = { $in: ["$status", ["LOSS", "LOSE"]] };

function groupMetrics(idExpr) {
    return {
        _id: idExpr,
        count: { $sum: 1 },
        profit: { $sum: profitExpr },
        roi: { $sum: { $ifNull: ["$roe", 0] } },
        cost: { $sum: { $ifNull: ["$costAmount", 0] } },
        volume: { $sum: volumeExpr },
        maxVolume: { $max: volumeExpr },
        minVolume: { $min: volumeExpr },
        wins: { $sum: { $cond: [winCond, 1, 0] } },
        losses: { $sum: { $cond: [lossCond, 1, 0] } },
        winRoe: { $sum: { $cond: [winCond, { $ifNull: ["$roe", 0] }, 0] } },
        lossRoe: { $sum: { $cond: [lossCond, { $ifNull: ["$roe", 0] }, 0] } },
        maxProfit: { $max: profitExpr },
        minProfit: { $min: profitExpr },
        longCount: { $sum: { $cond: [{ $eq: ["$side", "LONG"] }, 1, 0] } },
        shortCount: { $sum: { $cond: [{ $eq: ["$side", "SHORT"] }, 1, 0] } },
        longProfit: { $sum: { $cond: [{ $eq: ["$side", "LONG"] }, profitExpr, 0] } },
        shortProfit: { $sum: { $cond: [{ $eq: ["$side", "SHORT"] }, profitExpr, 0] } },
    };
}

function presentGroup(row, nameKey) {
    const count = row?.count || 0;
    const wins = row?.wins || 0;
    const losses = row?.losses || 0;
    const cost = row?.cost || 0;
    const volume = row?.volume || 0;
    const profit = row?.profit || 0;
    return {
        [nameKey]: row?._id || "UNKNOWN",
        count,
        wins,
        losses,
        winRate: count ? (wins / count) * 100 : 0,
        profit,
        roi: row?.roi || 0,
        cost,
        avgRoi: cost ? (profit / cost) * 100 : 0,
        volume,
        avgVolume: count ? volume / count : 0,
        maxVolume: row?.maxVolume ?? null,
        minVolume: row?.minVolume ?? null,
        maxProfit: row?.maxProfit ?? null,
        minProfit: row?.minProfit ?? null,
        avgWinRoe: wins ? (row?.winRoe || 0) / wins : 0,
        avgLossRoe: losses ? (row?.lossRoe || 0) / losses : 0,
        longCount: row?.longCount || 0,
        shortCount: row?.shortCount || 0,
        longProfit: row?.longProfit || 0,
        shortProfit: row?.shortProfit || 0,
    };
}

function byProfit(rows) {
    return [...rows].sort((a, b) => (b.profit || 0) - (a.profit || 0) || (b.count || 0) - (a.count || 0));
}

function presentConfigSignal(row) {
    const id = row?._id && typeof row._id === "object" ? row._id : {};
    return {
        env: id.env || "UNKNOWN",
        ...presentGroup({ ...row, _id: id.signal || "UNKNOWN" }, "signal"),
    };
}

function byConfigThenProfit(rows) {
    return [...rows].sort((a, b) => String(a.env).localeCompare(String(b.env)) || (b.profit || 0) - (a.profit || 0) || (b.count || 0) - (a.count || 0));
}

function signalMatch(input) {
    const signalNames = String(input.signal || "").split(",").map((item) => item.trim()).filter(Boolean);
    if (signalNames.length === 1) {
        const matcher = signalMatcher(signalNames[0]);
        return matcher ? { typeSignal: matcher } : {};
    }
    if (signalNames.length > 1) {
        const clauses = signalNames.map((name) => signalMatcher(name)).filter(Boolean).map((matcher) => ({ typeSignal: matcher }));
        return clauses.length ? { $or: clauses } : {};
    }
    return {};
}

async function resolveBook(input, envs) {
    const requested = String(input.book || "").trim().toLowerCase();
    if (requested === "live" || requested === "paper" || requested === "all") return requested;
    if (!envs.length) return "live";
    let rows = [];
    try {
        rows = await AccountConfig.find({ env: { $in: envs } }).select("env trade_config.PAPER").lean();
    } catch (error) {
        console.error("[listAccountStatics]", error?.code || error?.name || "paper-config");
        return "live";
    }
    const paper = new Set((rows || []).filter((row) => row?.trade_config?.PAPER === true).map((row) => row.env));
    return envs.every((env) => paper.has(env)) ? "paper" : "live";
}

function staticScope(input, envs, range) {
    const scope = { env: { $in: envs }, openTime: openTimeFilter(range) };
    const book = String(input.book || "live").trim().toLowerCase();
    if (book === "paper") scope.isPaper = true;
    else if (book !== "all") scope.isPaper = { $ne: true };
    const copy = String(input.copy || "").trim().toLowerCase();
    if (copy === "copy") scope.isCopy = true;
    else if (copy === "manual") scope.isCopy = { $ne: true };
    const closed = String(input.closed || "").trim().toLowerCase();
    if (closed === "closed") scope.isClosed = true;
    else if (closed === "open") scope.isClosed = { $ne: true };
    if (["LONG", "SHORT"].includes(input.side)) scope.side = input.side;
    const q = String(input.q || "").trim();
    if (q) scope.symbol = new RegExp(escapeRegex(q), "i");
    const filter = { ...scope, ...signalMatch(input) };
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
    const book = await resolveBook(input, envs);
    const { scope, filter } = staticScope({ ...input, book }, envs, range);

    const [rows, total, totals, breakdown] = await Promise.all([
        AccountStatic.find(filter).select(DETAIL_FIELDS).sort({ openTime: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
        AccountStatic.countDocuments(filter),
        AccountStatic.aggregate([{ $match: filter }, { $group: { ...groupMetrics(null), cost: { $sum: { $ifNull: ["$costAmount", 0] } }, longProfit: { $sum: { $cond: [{ $eq: ["$side", "LONG"] }, profitExpr, 0] } }, shortProfit: { $sum: { $cond: [{ $eq: ["$side", "SHORT"] }, profitExpr, 0] } } } }]),
        AccountStatic.aggregate([
            { $match: scope },
            {
                $facet: {
                    bySignal: [{ $group: groupMetrics("$typeSignal") }],
                    byConfigSignal: [{ $group: groupMetrics({ env: "$env", signal: "$typeSignal" }) }],
                    byEnv: [{ $group: groupMetrics("$env") }],
                    byConfig: [{ $match: signalMatch(input) }, { $group: groupMetrics("$env") }],
                    bySide: [{ $group: groupMetrics("$side") }],
                    byStatus: [{ $group: { _id: "$status", count: { $sum: 1 }, profit: { $sum: profitExpr } } }],
                },
            },
        ]),
    ]);
    const sum = totals[0] || { profit: 0, roi: 0, volume: 0, wins: 0, losses: 0, cost: 0, longProfit: 0, shortProfit: 0 };
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
            cost: sum.cost || 0,
            avgRoi: sum.cost ? (sum.profit / sum.cost) * 100 : 0,
            volume: sum.volume,
            longProfit: sum.longProfit || 0,
            shortProfit: sum.shortProfit || 0,
            bySignal: byProfit((facet.bySignal || []).map((row) => presentGroup(row, "signal"))),
            byConfigSignal: byConfigThenProfit((facet.byConfigSignal || []).map(presentConfigSignal)),
            byEnv: byProfit((facet.byEnv || []).map((row) => presentGroup(row, "env"))),
            byConfig: byProfit((facet.byConfig || []).map((row) => presentGroup(row, "env"))),
            bySide: (facet.bySide || []).map((row) => presentGroup(row, "side")),
            byStatus: (facet.byStatus || []).map((row) => ({ status: row._id || "UNKNOWN", count: row.count, profit: row.profit })),
        },
        page, limit, total, username, env: env || null, envs, book, from: range.from, to: range.to,
    };
}

async function getAccountStatic(actor, id, input = {}) {
    const username = String(input.username || "").trim();
    if (!username) throw httpError(400, "Thiếu user bot");
    if (!/^[a-f0-9]{24}$/i.test(String(id || ""))) throw httpError(400, "Mã giao dịch không hợp lệ");
    const bot = await requireBot(actor, username, PERMISSIONS.STATISTICS_VIEW);
    const row = await AccountStatic.findOne({ _id: id, env: { $in: bot.accounts || [] } }).select(DETAIL_FIELDS).lean();
    if (!row) throw httpError(404, "Không tìm thấy giao dịch");
    const trade = toStatic(row);
    try {
        trade.symbolInfo = await findSymbolInfo(row.symbol);
    } catch (error) {
        console.error("[getAccountStatic]", error?.code || error?.name || "symbolInfo");
        trade.symbolInfo = null;
    }
    return trade;
}

async function listAssignedStatics(actor, input = {}) {
    const { assignedUsers } = require("./account-ledger");
    const users = await assignedUsers(actor);
    const envUser = new Map();
    for (const user of users) {
        for (const env of user.accounts || []) {
            const name = String(env || "").trim();
            if (name && !envUser.has(name)) envUser.set(name, user.username);
        }
    }
    const envs = [...envUser.keys()];
    const range = openTimeRange(input);
    const empty = {
        scope: "assigned",
        usernames: users.map((user) => user.username),
        stats: { total: 0, profit: 0, winRate: 0, byConfigSignal: [] },
        book: "live",
        from: range.from,
        to: range.to,
    };
    if (!envs.length) return empty;
    const filter = { env: { $in: envs }, openTime: openTimeFilter(range), isPaper: { $ne: true } };
    const [total, totals, grouped] = await Promise.all([
        AccountStatic.countDocuments(filter),
        AccountStatic.aggregate([{ $match: filter }, { $group: { _id: null, profit: { $sum: profitExpr }, wins: { $sum: { $cond: [winCond, 1, 0] } } } }]),
        AccountStatic.aggregate([{ $match: filter }, { $group: groupMetrics({ env: "$env", signal: "$typeSignal" }) }]),
    ]);
    const sum = totals[0] || { profit: 0, wins: 0 };
    return {
        ...empty,
        stats: {
            total,
            profit: sum.profit || 0,
            winRate: total ? ((sum.wins || 0) / total) * 100 : 0,
            byConfigSignal: (grouped || []).map((row) => ({
                username: envUser.get(row?._id?.env) || "UNKNOWN",
                ...presentConfigSignal(row),
            })).sort((a, b) => String(a.username).localeCompare(String(b.username)) || String(a.env).localeCompare(String(b.env)) || (b.profit || 0) - (a.profit || 0)),
        },
    };
}

module.exports = { listAccountStatics, listAssignedStatics, getAccountStatic };
