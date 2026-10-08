const UserAccount = require("../models/user-account");
const AccountConfig = require("../models/account-config");
const AccountStatic = require("../models/account-static");
const FuturesProfit = require("../models/futures-profit");
const MonitorPosition = require("../models/monitor-position");
const SummaryCache = require("../models/summary-cache");
const { PERMISSIONS, canAccessResource } = require("../auth/access-control");
const { httpError } = require("./http");

const RANGE_DAYS = Object.freeze({ today: 0, "3d": 3, "7d": 7, "30d": 30, "90d": 90, all: null });
const CACHE_TTL_MS = 60 * 1000;
const CACHE_VERSION = "v6";

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
    const range = String(value || "today").trim().toLowerCase();
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

function envKey(value) {
    return String(value || "").trim().toUpperCase();
}

function ownsEnv(bot, env) {
    const key = envKey(env);
    return !!key && (bot.accounts || []).some((item) => envKey(item) === key);
}

function blankRank(username) {
    return {
        name: username, profit: 0, volume: 0, trades: 0, wins: 0, losses: 0,
        balance: 0, balanceKnown: false, roiAcc: 0, roiWeight: 0,
    };
}

function addFutures(current, row) {
    if (!row) return;
    current.profit += row.profit || 0;
    if (row.balance != null) {
        current.balance += row.balance;
        current.balanceKnown = true;
    }
    if (row.roi != null && Number(row.balance) > 0) {
        current.roiAcc += row.roi * row.balance;
        current.roiWeight += row.balance;
    }
}

function rankUsers(byEnv, bots, futuresRows) {
    const futures = new Map();
    for (const row of futuresRows || []) {
        const key = envKey(row?._id);
        if (key) futures.set(key, row);
    }
    const totals = new Map();
    const seen = new Set();
    function ownersOf(env) {
        return (bots || []).filter((bot) => isActiveBot(bot) && ownsEnv(bot, env));
    }
    function ensure(owner) {
        if (!totals.has(owner.username)) totals.set(owner.username, blankRank(owner.username));
        return totals.get(owner.username);
    }
    for (const bot of bots || []) {
        if (isActiveBot(bot)) ensure(bot);
    }
    for (const row of byEnv || []) {
        const env = String(row?._id || "").trim();
        if (!env) continue;
        const key = envKey(env);
        for (const owner of ownersOf(env)) {
            const current = ensure(owner);
            current.volume += row.volume || 0;
            current.trades += row.trades || 0;
            current.wins += row.wins || 0;
            current.losses += row.losses || 0;
            if (!seen.has(`${owner.username}:${key}`)) addFutures(current, futures.get(key));
            seen.add(`${owner.username}:${key}`);
        }
        seen.add(key);
    }
    for (const [key, row] of futures) {
        if (seen.has(key)) continue;
        for (const owner of ownersOf(key)) {
            if (seen.has(`${owner.username}:${key}`)) continue;
            addFutures(ensure(owner), row);
            seen.add(`${owner.username}:${key}`);
        }
    }
    return [...totals.values()]
        .map((row) => ({
            name: row.name,
            profit: row.profit,
            balance: row.balanceKnown ? row.balance : null,
            roi: row.roiWeight > 0 ? row.roiAcc / row.roiWeight : null,
            volume: row.volume,
            trades: row.trades,
            wins: row.wins,
            losses: row.losses,
            winRate: winRate(row.wins, row.losses),
        }))
        .sort((a, b) => b.profit - a.profit || b.volume - a.volume || b.trades - a.trades);
}

function normalizeAudience(value) {
    const audience = String(value || "system").trim().toLowerCase();
    if (audience !== "mine" && audience !== "system") throw httpError(400, "Phạm vi xem không hợp lệ");
    return audience;
}

function isMineBot(actor, bot) {
    const id = String(actor?.id || "");
    if (bot?.ownerUserId && String(bot.ownerUserId) === id) return true;
    if (!bot?.ownerUserId && [actor?.username, actor?.email].filter(Boolean).includes(bot?.username)) return true;
    return (actor?.botUsernames || []).includes(bot?.username);
}

function canSeeSystemBot(actor, bot) {
    return [PERMISSIONS.BOTS_VIEW, PERMISSIONS.STATISTICS_VIEW]
        .some((permission) => canAccessResource(actor, permission, bot));
}

function visibleBots(bots, actor, audience) {
    return (bots || []).filter((bot) => {
        if (!isActiveBot(bot)) return false;
        if (!actor) return true;
        if (audience === "mine") return isMineBot(actor, bot);
        return canSeeSystemBot(actor, bot);
    });
}

function sideProfit(rows, side) {
    const row = (rows || []).find((item) => String(item?._id || "").toUpperCase() === side);
    return row?.profit || 0;
}

async function enteredSignalCounts(envFilter, selectedDates, last24Hours) {
    const match = {
        ...envFilter,
        isPaper: { $ne: true },
        typeSignal: { $nin: [null, ""] },
        openTime: selectedDates || { $ne: null },
    };
    const rows = await AccountStatic.aggregate([
        { $match: match },
        {
            $group: {
                _id: { $toUpper: "$typeSignal" },
                recent: { $max: { $cond: [{ $gte: ["$openTime", last24Hours] }, 1, 0] } },
            },
        },
    ]);
    return {
        signalCount: rows.length,
        signalCount24h: rows.filter((row) => row.recent).length,
    };
}

async function getSystemSummary(rangeInput = "today", now = new Date(), actor = null, audienceInput = "system") {
    const range = normalizeSummaryRange(rangeInput);
    const audience = actor ? normalizeAudience(audienceInput) : "system";
    const bots = visibleBots(await UserAccount.find().select("username accounts ownerUserId visibility active").lean(), actor, audience);
    const envs = [...new Set(bots.flatMap((bot) => bot.accounts || []).filter(Boolean))];
    const dayStart = startOfUtcDay(now);
    const last24Hours = new Date(now.getTime() - (24 * 60 * 60 * 1000));
    const envFilter = envs.length ? { env: { $in: envs } } : { _id: null };
    const futuresEnvs = [...new Set(envs.flatMap((item) => [item, envKey(item)]).filter(Boolean))];
    const futuresEnvFilter = futuresEnvs.length ? { env: { $in: futuresEnvs } } : { _id: null };
    const selectedDates = dateFilter(range, now);

    const [activeConfigCount, enteredSignals, openPositionCount, tradeRows, futuresRows] = await Promise.all([
        AccountConfig.countDocuments({ ...envFilter, "trade_config.ON": true }),
        enteredSignalCounts(envFilter, selectedDates, last24Hours),
        MonitorPosition.countDocuments({ ...envFilter, closed: { $ne: true }, isPaper: { $ne: true }, "config.PAPER": { $ne: true } }),
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
        FuturesProfit.aggregate([
            { $match: { ...futuresEnvFilter, ...(selectedDates ? { day: { $gte: startOfUtcDay(selectedDates.$gte), $lte: selectedDates.$lte } } : {}) } },
            { $sort: { day: 1 } },
            {
                $group: {
                    _id: { $toUpper: { $ifNull: ["$env", ""] } },
                    profit: { $sum: { $ifNull: ["$profit", 0] } },
                    balance: { $last: "$balance" },
                    roi: { $last: "$roi" },
                },
            },
        ]),
    ]);

    const facet = tradeRows[0] || {};
    const trades = facet.totals?.[0] || {};
    const signalLeaders = leaders(facet.bySignal);
    const symbolLeaders = leaders(facet.bySymbol);
    const userRanks = rankUsers(facet.byEnv, bots, futuresRows);
    const configCount = bots.reduce((total, bot) => total + (bot.accounts || []).length, 0);
    const privateBotCount = bots.filter((bot) => bot.visibility === "private").length;

    return {
        botCount: bots.length,
        publicBotCount: bots.length - privateBotCount,
        privateBotCount,
        configCount,
        activeConfigCount,
        inactiveConfigCount: Math.max(0, configCount - activeConfigCount),
        signalCount: enteredSignals.signalCount,
        signalCount24h: enteredSignals.signalCount24h,
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

async function getCachedSystemSummary(rangeInput = "today", now = new Date()) {
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

module.exports = { RANGE_DAYS, CACHE_TTL_MS, getSystemSummary, getCachedSystemSummary, clearSystemSummaryCache, normalizeSummaryRange, normalizeAudience, dateFilter, startOfUtcDay };
