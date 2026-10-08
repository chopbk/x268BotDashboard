const UserAccount = require("../models/user-account");
const AccountConfig = require("../models/account-config");
const SignalInfo = require("../models/signal-info");
const AccountStatic = require("../models/account-static");
const MonitorPosition = require("../models/monitor-position");
const SummaryCache = require("../models/summary-cache");
const { httpError } = require("./http");

const RANGE_DAYS = Object.freeze({ today: 0, "3d": 3, "7d": 7, "30d": 30, "90d": 90, all: null });
const CACHE_TTL_MS = 60 * 1000;
const CACHE_VERSION = "v4";

const volumeExpr = {
    $ifNull: [
        "$volume",
        { $multiply: [{ $ifNull: ["$costAmount", 0] }, { $abs: { $ifNull: ["$futuresLeverage", 1] } }] },
    ],
};
const profitExpr = { $ifNull: ["$profit", 0] };
const winExpr = { $sum: { $cond: [{ $eq: ["$status", "WIN"] }, 1, 0] } };
const lossExpr = { $sum: { $cond: [{ $in: ["$status", ["LOSS", "LOSE"]] }, 1, 0] } };

function startOfUtcDay(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function normalizeSummaryRange(value) {
    const range = String(value || "3d").trim().toLowerCase();
    if (!Object.hasOwn(RANGE_DAYS, range)) throw httpError(400, "Khoảng thời gian không hợp lệ");
    return range;
}

function dateFilter(range, now) {
    const days = RANGE_DAYS[range];
    if (days == null) return null;
    const from = days === 0 ? startOfUtcDay(now) : new Date(now.getTime() - (days * 24 * 60 * 60 * 1000));
    return { $gte: from, $lte: now };
}

function closedAtExpr(from, to) {
    const closedAt = { $ifNull: ["$closeTime", "$openTime"] };
    return { $and: [{ $gte: [closedAt, from] }, { $lte: [closedAt, to] }] };
}

function tradeMatch(envFilter, selectedDates) {
    const match = { ...envFilter, isPaper: false };
    if (selectedDates) match.$expr = closedAtExpr(selectedDates.$gte, selectedDates.$lte);
    return match;
}

function winRate(wins, losses) {
    const decided = (wins || 0) + (losses || 0);
    return decided ? ((wins || 0) / decided) * 100 : 0;
}

function performance(row) {
    if (!row?.name) return null;
    return {
        name: row.name,
        profit: row.profit || 0,
        trades: row.trades || 0,
        winRate: winRate(row.wins, row.losses),
    };
}

function rankRows(rows) {
    return (rows || [])
        .filter((row) => row?._id)
        .map((row) => ({
            name: String(row._id).trim(),
            profit: row.profit || 0,
            trades: row.trades || 0,
            wins: row.wins || 0,
            losses: row.losses || 0,
        }))
        .filter((row) => row.name)
        .sort((a, b) => b.profit - a.profit || b.trades - a.trades);
}

function leaders(rows) {
    const ranked = rankRows(rows);
    const named = ranked.filter((row) => row.name !== "UNKNOWN");
    const pool = named.length ? named : ranked;
    if (!pool.length) return { best: null, worst: null };
    const worst = pool.length > 1 && pool[pool.length - 1].name !== pool[0].name
        ? performance(pool[pool.length - 1])
        : null;
    return { best: performance(pool[0]), worst };
}

function isActiveBot(bot) {
    return !!bot?.username && bot.active !== false;
}

function rankUsers(byEnv, bots) {
    const totals = new Map();
    for (const row of byEnv || []) {
        const env = String(row?._id || "").trim();
        if (!env) continue;
        const owners = (bots || []).filter((bot) => isActiveBot(bot) && (bot.accounts || []).includes(env));
        for (const owner of owners) {
            const current = totals.get(owner.username) || {
                name: owner.username, profit: 0, volume: 0, trades: 0, wins: 0, losses: 0,
            };
            current.profit += row.profit || 0;
            current.volume += row.volume || 0;
            current.trades += row.trades || 0;
            current.wins += row.wins || 0;
            current.losses += row.losses || 0;
            totals.set(owner.username, current);
        }
    }
    return [...totals.values()]
        .map((row) => ({ ...row, winRate: winRate(row.wins, row.losses) }))
        .sort((a, b) => b.profit - a.profit || b.volume - a.volume || b.trades - a.trades);
}

function sideProfit(rows, side) {
    const row = (rows || []).find((item) => String(item?._id || "").toUpperCase() === side);
    return row?.profit || 0;
}

async function getSystemSummary(rangeInput = "3d", now = new Date()) {
    const range = normalizeSummaryRange(rangeInput);
    const bots = (await UserAccount.find().select("username accounts visibility active").lean()).filter(isActiveBot);
    const envs = [...new Set(bots.flatMap((bot) => bot.accounts || []).filter(Boolean))];
    const dayStart = startOfUtcDay(now);
    const last24Hours = new Date(now.getTime() - (24 * 60 * 60 * 1000));
    const envFilter = envs.length ? { env: { $in: envs } } : { _id: null };
    const selectedDates = dateFilter(range, now);
    const signalFilter = selectedDates ? { openTime: selectedDates } : {};

    const [activeConfigCount, signalCount, signalCount24h, openPositionCount, tradeRows] = await Promise.all([
        AccountConfig.countDocuments({ ...envFilter, "trade_config.ON": true }),
        SignalInfo.countDocuments(signalFilter),
        SignalInfo.countDocuments({ openTime: { $gte: last24Hours } }),
        MonitorPosition.countDocuments({ ...envFilter, $or: [{ closed: false }, { isClosed: false }] }),
        AccountStatic.aggregate([
            { $match: tradeMatch(envFilter, selectedDates) },
            {
                $facet: {
                    totals: [{
                        $group: {
                            _id: null,
                            tradeCount: { $sum: 1 },
                            wins: winExpr,
                            losses: lossExpr,
                            volume: { $sum: volumeExpr },
                            profit: { $sum: profitExpr },
                        },
                    }],
                    today: [
                        { $match: { $expr: closedAtExpr(dayStart, now) } },
                        { $group: { _id: null, profit: { $sum: profitExpr } } },
                    ],
                    bySignal: [{
                        $group: {
                            _id: { $ifNull: ["$typeSignal", ""] },
                            profit: { $sum: profitExpr },
                            trades: { $sum: 1 },
                            wins: winExpr,
                            losses: lossExpr,
                        },
                    }],
                    bySymbol: [{
                        $group: {
                            _id: { $ifNull: ["$symbol", ""] },
                            profit: { $sum: profitExpr },
                            trades: { $sum: 1 },
                            wins: winExpr,
                            losses: lossExpr,
                        },
                    }],
                    byEnv: [{
                        $group: {
                            _id: "$env",
                            profit: { $sum: profitExpr },
                            volume: { $sum: volumeExpr },
                            trades: { $sum: 1 },
                            wins: winExpr,
                            losses: lossExpr,
                        },
                    }],
                    bySide: [{ $group: { _id: { $ifNull: ["$side", ""] }, profit: { $sum: profitExpr } } }],
                },
            },
        ]),
    ]);

    const facet = tradeRows[0] || {};
    const trades = facet.totals?.[0] || {};
    const signalLeaders = leaders(facet.bySignal);
    const symbolLeaders = leaders(facet.bySymbol);
    const userRanks = rankUsers(facet.byEnv, bots);
    const configCount = bots.reduce((total, bot) => total + (bot.accounts || []).length, 0);
    const privateBotCount = bots.filter((bot) => bot.visibility === "private").length;

    return {
        botCount: bots.length,
        publicBotCount: bots.length - privateBotCount,
        privateBotCount,
        configCount,
        activeConfigCount,
        inactiveConfigCount: Math.max(0, configCount - activeConfigCount),
        signalCount,
        signalCount24h,
        tradeCount: trades.tradeCount || 0,
        wins: trades.wins || 0,
        losses: trades.losses || 0,
        openPositionCount,
        winRate: winRate(trades.wins, trades.losses),
        profit: trades.profit || 0,
        profitToday: facet.today?.[0]?.profit || 0,
        volume: trades.volume || 0,
        longProfit: sideProfit(facet.bySide, "LONG"),
        shortProfit: sideProfit(facet.bySide, "SHORT"),
        bestSignal: signalLeaders.best,
        worstSignal: signalLeaders.worst,
        bestUser: performance(userRanks[0]),
        userRanks,
        bestSymbol: symbolLeaders.best,
        range,
        from: selectedDates?.$gte || null,
        to: now,
        generatedAt: now,
    };
}

async function getCachedSystemSummary(rangeInput = "3d", now = new Date()) {
    const range = normalizeSummaryRange(rangeInput);
    const key = `${CACHE_VERSION}:${range}`;
    const cached = await SummaryCache.findOne({ _id: key, expiresAt: { $gt: now } }).select("payload").lean();
    if (cached?.payload) return { ...cached.payload, cached: true };

    const value = await getSystemSummary(range, now);
    await SummaryCache.findOneAndUpdate(
        { _id: key },
        { $set: { payload: value, generatedAt: now, expiresAt: new Date(now.getTime() + CACHE_TTL_MS) } },
        { upsert: true }
    );
    return { ...value, cached: false };
}

async function clearSystemSummaryCache() {
    await SummaryCache.deleteMany({ _id: new RegExp(`^${CACHE_VERSION}:`) });
}

module.exports = { RANGE_DAYS, CACHE_TTL_MS, getSystemSummary, getCachedSystemSummary, clearSystemSummaryCache, normalizeSummaryRange, dateFilter, startOfUtcDay };
