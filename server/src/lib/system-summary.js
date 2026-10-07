const UserAccount = require("../models/user-account");
const AccountConfig = require("../models/account-config");
const SignalInfo = require("../models/signal-info");
const AccountStatic = require("../models/account-static");

function startOfUtcDay(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

async function getSystemSummary(now = new Date()) {
    const bots = await UserAccount.find().select("accounts visibility").lean();
    const envs = [...new Set(bots.flatMap((bot) => bot.accounts || []).filter(Boolean))];
    const dayStart = startOfUtcDay(now);
    const last24Hours = new Date(now.getTime() - (24 * 60 * 60 * 1000));
    const envFilter = envs.length ? { env: { $in: envs } } : { _id: null };

    const [activeConfigCount, signalCount, signalCount24h, tradeRows] = await Promise.all([
        AccountConfig.countDocuments({ ...envFilter, "trade_config.ON": true }),
        SignalInfo.countDocuments(),
        SignalInfo.countDocuments({ openTime: { $gte: last24Hours } }),
        AccountStatic.aggregate([
            { $match: envFilter },
            {
                $group: {
                    _id: null,
                    tradeCount: { $sum: 1 },
                    openPositionCount: { $sum: { $cond: [{ $eq: ["$isClosed", false] }, 1, 0] } },
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
        openPositionCount: trades.openPositionCount || 0,
        winRate: decidedTrades ? ((trades.wins || 0) / decidedTrades) * 100 : 0,
        profit: trades.profit || 0,
        profitToday: trades.profitToday || 0,
        volume: trades.volume || 0,
        generatedAt: now,
    };
}

module.exports = { getSystemSummary, startOfUtcDay };
