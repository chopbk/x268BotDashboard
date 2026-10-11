const SignalInfo = require("../models/signal-info");
const AccountStatic = require("../models/account-static");
const TelegramClient = require("../models/telegram-client");
const { PERMISSIONS, hasPermission } = require("../auth/access-control");
const { openTimeFilter, openTimeRange } = require("./open-time-range");
const { httpError } = require("./http");

const SORTS = new Set(["profit", "winRate", "trades", "feed", "volume"]);

const volumeExpr = {
    $ifNull: ["$volume", { $multiply: [{ $ifNull: ["$costAmount", 0] }, { $abs: { $ifNull: ["$futuresLeverage", 1] } }] }],
};
const profitExpr = { $ifNull: ["$profit", 0] };
const winCond = { $eq: ["$status", "WIN"] };
const lossCond = { $in: ["$status", ["LOSS", "LOSE"]] };
const signalKey = { $toUpper: { $ifNull: ["$signal", ""] } };
const typeSignalKey = { $toUpper: { $ifNull: ["$typeSignal", ""] } };

function roundMoney(value) {
    const n = Number(value) || 0;
    return Math.round(n * 100) / 100;
}

function bookFilter(book) {
    const value = String(book || "live").trim().toLowerCase();
    if (value === "paper") return { isPaper: true };
    if (value === "all") return {};
    return { isPaper: { $ne: true } };
}

function normalizeSort(value) {
    const key = String(value || "profit").trim();
    return SORTS.has(key) ? key : "profit";
}

async function listChannelNames() {
    const rows = await TelegramClient.find().select("channels.name").lean();
    const names = new Set();
    for (const row of rows || []) {
        for (const channel of row.channels || []) {
            const name = String(channel?.name || "").trim().toUpperCase();
            if (name) names.add(name);
        }
    }
    return names;
}

function emptyRow(signal) {
    return {
        signal,
        channel: false,
        feed: 0,
        feedLong: 0,
        feedShort: 0,
        trades: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        profit: 0,
        volume: 0,
        cost: 0,
        avgRoi: 0,
        configs: 0,
        accounts: 0,
        longCount: 0,
        shortCount: 0,
        longProfit: 0,
        shortProfit: 0,
        envs: [],
    };
}

function sortRows(rows, sort) {
    return [...rows].sort((a, b) => {
        if (sort === "winRate") return (b.winRate || 0) - (a.winRate || 0) || (b.trades || 0) - (a.trades || 0) || a.signal.localeCompare(b.signal);
        if (sort === "trades") return (b.trades || 0) - (a.trades || 0) || (b.profit || 0) - (a.profit || 0) || a.signal.localeCompare(b.signal);
        if (sort === "feed") return (b.feed || 0) - (a.feed || 0) || (b.trades || 0) - (a.trades || 0) || a.signal.localeCompare(b.signal);
        if (sort === "volume") return (b.volume || 0) - (a.volume || 0) || (b.profit || 0) - (a.profit || 0) || a.signal.localeCompare(b.signal);
        return (b.profit || 0) - (a.profit || 0) || (b.trades || 0) - (a.trades || 0) || a.signal.localeCompare(b.signal);
    });
}

async function listProviderScorecard(actor, input = {}) {
    if (!actor) throw httpError(401, "Chưa đăng nhập");
    const canSeeFeed = hasPermission(actor, PERMISSIONS.SIGNALS_HISTORY);
    const canSeeTrades = hasPermission(actor, PERMISSIONS.STATISTICS_VIEW);
    if (!canSeeFeed && !canSeeTrades) throw httpError(403, "Không có quyền");

    const range = openTimeRange(input);
    const timeFilter = openTimeFilter(range);
    const scope = input.scope === "all" ? "all" : "mine";
    const book = String(input.book || "live").trim().toLowerCase() === "paper"
        ? "paper"
        : String(input.book || "live").trim().toLowerCase() === "all"
            ? "all"
            : "live";
    const sort = normalizeSort(input.sort);
    const minTrades = Math.max(0, Number.parseInt(input.minTrades, 10) || 0);
    const query = String(input.q || "").trim().toUpperCase();

    const channelNames = await listChannelNames();
    const bySignal = new Map();

    if (canSeeFeed) {
        const match = timeFilter ? { openTime: timeFilter } : {};
        const feedRows = await SignalInfo.aggregate([
            { $match: match },
            {
                $group: {
                    _id: signalKey,
                    feed: { $sum: 1 },
                    feedLong: { $sum: { $cond: [{ $eq: ["$side", "LONG"] }, 1, 0] } },
                    feedShort: { $sum: { $cond: [{ $eq: ["$side", "SHORT"] }, 1, 0] } },
                },
            },
        ]);
        for (const row of feedRows || []) {
            const signal = String(row._id || "").trim().toUpperCase();
            if (!signal) continue;
            const bucket = bySignal.get(signal) || emptyRow(signal);
            bucket.feed = row.feed || 0;
            bucket.feedLong = row.feedLong || 0;
            bucket.feedShort = row.feedShort || 0;
            bySignal.set(signal, bucket);
        }
    }

    let usernames = [];
    if (canSeeTrades) {
        const { usersForAudience } = require("./account-ledger");
        const users = await usersForAudience(actor, scope, PERMISSIONS.STATISTICS_VIEW);
        usernames = users.map((user) => user.username);
        const envUser = new Map();
        for (const user of users) {
            for (const env of user.accounts || []) {
                const name = String(env || "").trim();
                if (name && !envUser.has(name)) envUser.set(name, user.username);
            }
        }
        const envs = [...envUser.keys()];
        if (envs.length) {
            const match = {
                env: { $in: envs },
                ...(timeFilter ? { openTime: timeFilter } : {}),
                ...bookFilter(book),
            };
            const tradeRows = await AccountStatic.aggregate([
                { $match: match },
                {
                    $group: {
                        _id: typeSignalKey,
                        trades: { $sum: 1 },
                        wins: { $sum: { $cond: [winCond, 1, 0] } },
                        losses: { $sum: { $cond: [lossCond, 1, 0] } },
                        profit: { $sum: profitExpr },
                        volume: { $sum: volumeExpr },
                        cost: { $sum: { $ifNull: ["$costAmount", 0] } },
                        longCount: { $sum: { $cond: [{ $eq: ["$side", "LONG"] }, 1, 0] } },
                        shortCount: { $sum: { $cond: [{ $eq: ["$side", "SHORT"] }, 1, 0] } },
                        longProfit: { $sum: { $cond: [{ $eq: ["$side", "LONG"] }, profitExpr, 0] } },
                        shortProfit: { $sum: { $cond: [{ $eq: ["$side", "SHORT"] }, profitExpr, 0] } },
                        envs: { $addToSet: "$env" },
                    },
                },
            ]);
            for (const row of tradeRows || []) {
                const signal = String(row._id || "").trim().toUpperCase();
                if (!signal) continue;
                const bucket = bySignal.get(signal) || emptyRow(signal);
                const trades = row.trades || 0;
                const wins = row.wins || 0;
                const cost = row.cost || 0;
                const profit = row.profit || 0;
                const envList = (row.envs || []).map((item) => String(item || "").trim()).filter(Boolean);
                const accounts = new Set(envList.map((env) => envUser.get(env) || envUser.get(env.toUpperCase())).filter(Boolean));
                bucket.trades = trades;
                bucket.wins = wins;
                bucket.losses = row.losses || 0;
                bucket.winRate = trades ? (wins / trades) * 100 : 0;
                bucket.profit = roundMoney(profit);
                bucket.volume = roundMoney(row.volume || 0);
                bucket.cost = roundMoney(cost);
                bucket.avgRoi = cost ? (profit / cost) * 100 : 0;
                bucket.configs = envList.length;
                bucket.accounts = accounts.size;
                bucket.longCount = row.longCount || 0;
                bucket.shortCount = row.shortCount || 0;
                bucket.longProfit = roundMoney(row.longProfit || 0);
                bucket.shortProfit = roundMoney(row.shortProfit || 0);
                bucket.envs = envList;
                bySignal.set(signal, bucket);
            }
        }
    }

    let rows = [...bySignal.values()].map((row) => {
        const { envs: _envs, ...rest } = row;
        return { ...rest, channel: channelNames.has(row.signal) };
    });
    if (query) rows = rows.filter((row) => row.signal.includes(query));
    if (minTrades > 0) rows = rows.filter((row) => (row.trades || 0) >= minTrades);
    rows = sortRows(rows, sort);

    const feedTotal = rows.reduce((sum, row) => sum + (row.feed || 0), 0);
    const tradesTotal = rows.reduce((sum, row) => sum + (row.trades || 0), 0);
    const winsTotal = rows.reduce((sum, row) => sum + (row.wins || 0), 0);
    const profitTotal = rows.reduce((sum, row) => sum + (row.profit || 0), 0);

    return {
        from: range.from,
        to: range.to,
        scope,
        book,
        sort,
        minTrades,
        q: query || "",
        canSeeFeed,
        canSeeTrades,
        usernames,
        formula: {
            feed: "signal_infos theo openTime, cả hệ thống khi có signals.history",
            trades: "account_statics theo openTime, env trong scope bot khi có statistics.view",
            win: "status WIN; LOSS/LOSE là thua — không dùng profit > 0 như Tìm Signal",
            pnl: "Tổng field profit đã lưu trên account_statics; không cộng live với paper",
        },
        summary: {
            providers: rows.length,
            feed: feedTotal,
            trades: tradesTotal,
            profit: roundMoney(profitTotal),
            winRate: tradesTotal ? (winsTotal / tradesTotal) * 100 : 0,
        },
        rows,
    };
}

module.exports = { listProviderScorecard, SORTS };
