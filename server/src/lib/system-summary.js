const UserAccount = require("../models/user-account");
const AccountConfig = require("../models/account-config");
const SignalInfo = require("../models/signal-info");
const AccountStatic = require("../models/account-static");
const { httpError } = require("./http");

const RANGE_DAYS = Object.freeze({ "3d": 3, "7d": 7, "30d": 30, "90d": 90, all: null });
const CACHE_TTL_MS = 60 * 1000;
const summaryCache = new Map();

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
    return days == null ? null : { $gte: new Date(now.getTime() - (days * 24 * 60 * 60 * 1000)) };
}

async function getSystemSummary(rangeInput = "3d", now = new Date()) {
    const range = normalizeSummaryRange(rangeInput);
    const bots = await UserAccount.find().select("accounts visibility").lean();
    const envs = [...new Set(bots.flatMap((bot) => bot.accounts || []).filter(Boolean))];
    const dayStart = startOfUtcDay(now);
    const last24Hours = new Date(now.getTime() - (24 * 60 * 60 * 1000));
    const envFilter = envs.length ? { env: { $in: envs } } : { _id: null };
    const selectedDates = dateFilter(range, now);
    const signalFilter = selectedDates ? { openTime: selectedDates } : {};
    const tradeFilter = selectedDates ? { ...envFilter, openTime: selectedDates } : envFilter;

    const [activeConfigCount, signalCount, signalCount24h, openPositionCount, tradeRows] = await Promise.all([
        AccountConfig.countDocuments({ ...envFilter, "trade_config.ON": true }),
        SignalInfo.countDocuments(signalFilter),
        SignalInfo.countDocuments({ openTime: { $gte: last24Hours } }),
        AccountStatic.countDocuments({ ...envFilter, isClosed: false }),
        AccountStatic.aggregate([
            { $match: tradeFilter },
            {
                $group: {
                    _id: null,
                    tradeCount: { $sum: 1 },
                    wins: { $sum: { $cond: [{ $eq: ["$status", "WIN"] }, 1, 0] } },
                    losses: { $sum: { $cond: [{ $in: ["$status", ["LOSS", "LOSE"]] }, 1, 0] } },
                    profit: { $sum: { $ifNull: ["$profit", 0] } },
                    profitToday: { $sum: { $cond: [{ $gte: [{ $ifNull: ["$closeTime", "$openTime"] }, dayStart] }, { $ifNull: ["$profit", 0] }, 0] } },
                    volume: {
                        $sum: {
                            $ifNull: [
                                "$volume",
                                { $multiply: [{ $ifNull: ["$costAmount", 0] }, { $abs: { $ifNull: ["$futuresLeverage", 1] } }] },
                            ],
                        },
                    },
                },
            },
        ]),
    ]);

    const trades = tradeRows[0] || {};
    const decidedTrades = (trades.wins || 0) + (trades.losses || 0);
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
        openPositionCount,
        winRate: decidedTrades ? ((trades.wins || 0) / decidedTrades) * 100 : 0,
        profit: trades.profit || 0,
        profitToday: trades.profitToday || 0,
        volume: trades.volume || 0,
        range,
        from: selectedDates?.$gte || null,
        to: now,
        generatedAt: now,
    };
}

async function getCachedSystemSummary(rangeInput = "3d", now = new Date()) {
    const range = normalizeSummaryRange(rangeInput);
    const cached = summaryCache.get(range);
    if (cached && cached.expiresAt > now.getTime()) return { ...cached.value, cached: true };
    if (cached?.pending) return { ...(await cached.pending), cached: true };

    const pending = getSystemSummary(range, now);
    summaryCache.set(range, { pending, expiresAt: now.getTime() + CACHE_TTL_MS });
    try {
        const value = await pending;
        summaryCache.set(range, { value, expiresAt: now.getTime() + CACHE_TTL_MS });
        return { ...value, cached: false };
    } catch (error) {
        summaryCache.delete(range);
        throw error;
    }
}

function clearSystemSummaryCache() {
    summaryCache.clear();
}

module.exports = { RANGE_DAYS, CACHE_TTL_MS, getSystemSummary, getCachedSystemSummary, clearSystemSummaryCache, normalizeSummaryRange, startOfUtcDay };
