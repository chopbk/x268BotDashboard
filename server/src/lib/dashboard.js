const UserAccount = require("../models/user-account");
const AccountConfig = require("../models/account-config");
const AccountStatic = require("../models/account-static");
const FuturesProfit = require("../models/futures-profit");
const UserApi = require("../models/user-api");
const RuntimeLog = require("../models/runtime-log");
const { PERMISSIONS, hasPermission } = require("../auth/access-control");
const { httpError } = require("./http");

const DAY_MS = 24 * 60 * 60 * 1000;

function isMine(actor, bot) {
    const username = bot?.username;
    if (!username || !actor) return false;
    const ownerUserId = bot.ownerUserId ? String(bot.ownerUserId) : "";
    if (ownerUserId && ownerUserId === String(actor.id || "")) return true;
    if (!ownerUserId && [actor.username, actor.email].filter(Boolean).includes(username)) return true;
    return (actor.botUsernames || []).includes(username);
}

function startOfUtcDay(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function envKey(value) {
    return String(value || "").trim().toUpperCase();
}

function ownerOf(bots, env) {
    const key = envKey(env);
    return bots.find((bot) => (bot.accounts || []).some((item) => envKey(item) === key)) || null;
}

function hasTextExpr(field) {
    return {
        $gt: [
            {
                $strLenCP: {
                    $convert: { input: `$${field}`, to: "string", onError: "", onNull: "" },
                },
            },
            0,
        ],
    };
}

async function getDashboard(actor, now = new Date()) {
    if (!actor) throw httpError(401, "Chưa đăng nhập");
    const canBots = hasPermission(actor, PERMISSIONS.BOTS_VIEW);
    const canConfig = hasPermission(actor, PERMISSIONS.CONFIG_VIEW);
    const canStats = hasPermission(actor, PERMISSIONS.STATISTICS_VIEW);
    const canKeys = hasPermission(actor, PERMISSIONS.CREDENTIALS_VIEW);
    const canLogs = hasPermission(actor, PERMISSIONS.LOGS_VIEW);
    const canSignals = canConfig || hasPermission(actor, PERMISSIONS.SIGNALS_HISTORY);
    if (!canBots) {
        return { bots: null, configs: null, profitToday: null, incomeToday: null, attention: [], mine: [] };
    }

    const rows = await UserAccount.find().select("username accounts ownerUserId visibility active").lean();
    const bots = rows.filter((bot) => isMine(actor, bot) && bot.username);
    const envs = [...new Set(bots.flatMap((bot) => bot.accounts || []).filter(Boolean))];
    const envFilter = envs.length ? { env: { $in: envs } } : null;
    const dayStart = startOfUtcDay(now);
    const futuresEnvs = [...new Set(envs.flatMap((item) => [item, envKey(item)]).filter(Boolean))];

    const configs = (canConfig || canSignals) && envFilter
        ? await AccountConfig.find(envFilter).select("env signals trade_config.ON").lean()
        : [];
    const mineSignals = [...new Set((configs || []).flatMap((doc) => (doc.signals || []).map((item) => String(item || "").trim().toUpperCase()).filter(Boolean)))];
    const [profitRows, incomeRows, apiRows, blocked, parseRows, removed] = await Promise.all([
        canStats && envFilter
            ? AccountStatic.aggregate([
                { $match: { ...envFilter, isPaper: false, $expr: { $and: [
                    { $gte: [{ $ifNull: ["$closeTime", "$openTime"] }, dayStart] },
                    { $lte: [{ $ifNull: ["$closeTime", "$openTime"] }, now] },
                ] } } },
                { $group: { _id: "$env", profit: { $sum: { $ifNull: ["$profit", 0] } } } },
            ])
            : [],
        canStats && futuresEnvs.length
            ? FuturesProfit.aggregate([
                { $match: { env: { $in: futuresEnvs }, day: { $gte: dayStart, $lte: now } } },
                { $group: { _id: null, profit: { $sum: { $ifNull: ["$profit", 0] } } } },
            ])
            : [],
        canKeys && bots.length
            ? UserApi.aggregate([
                { $match: { username: { $in: bots.map((bot) => bot.username) } } },
                { $project: { _id: 0, username: 1, hasApiKey: hasTextExpr("api_key") } },
            ])
            : [],
        canLogs && envFilter
            ? RuntimeLog.find({
                category: "signal",
                source: "callHandleSignalBot",
                at: { $gte: new Date(now.getTime() - 7 * DAY_MS) },
                ...envFilter,
            }).sort({ at: -1 }).limit(3).select("at env signal message").lean()
            : [],
        canSignals && mineSignals.length
            ? RuntimeLog.aggregate([
                { $match: { category: "signal", source: "parse", at: { $gte: new Date(now.getTime() - 7 * DAY_MS) }, signal: { $in: mineSignals } } },
                { $group: { _id: "$signal", count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 2 },
            ])
            : [],
        canSignals && envFilter
            ? RuntimeLog.find({
                category: "signal",
                source: "autoremove",
                at: { $gte: new Date(now.getTime() - 14 * DAY_MS) },
                ...envFilter,
            }).sort({ at: -1 }).limit(2).select("at env signal message").lean()
            : [],
    ]);

    const profitByEnv = new Map((profitRows || []).map((row) => [envKey(row._id), row.profit || 0]));
    const profitByUser = new Map();
    for (const [env, profit] of profitByEnv) {
        const bot = ownerOf(bots, env);
        if (!bot) continue;
        profitByUser.set(bot.username, (profitByUser.get(bot.username) || 0) + profit);
    }
    const onByUser = new Map();
    const attention = [];
    let onCount = 0;
    for (const doc of configs || []) {
        const on = doc.trade_config?.ON !== false;
        const names = (doc.signals || []).map((item) => String(item || "").trim()).filter(Boolean);
        const bot = ownerOf(bots, doc.env);
        if (!bot) continue;
        if (canConfig && on) {
            onCount += 1;
            onByUser.set(bot.username, (onByUser.get(bot.username) || 0) + 1);
        }
        if (canConfig && on && !names.length && attention.filter((item) => item.type === "config").length < 3) {
            attention.push({
                type: "config",
                title: `${bot.username}/${doc.env} đang bật nhưng chưa có signal`,
                href: `/bots/${encodeURIComponent(bot.username)}/accounts/${encodeURIComponent(doc.env)}`,
            });
        }
    }
    const keyed = new Set((apiRows || []).filter((row) => row.hasApiKey).map((row) => row.username));
    if (canKeys) {
        for (const bot of bots) {
            if (keyed.has(bot.username)) continue;
            if (attention.filter((item) => item.type === "api").length >= 3) break;
            attention.push({
                type: "api",
                title: `${bot.username} chưa có API key`,
                href: `/user-apis/${encodeURIComponent(bot.username)}`,
            });
        }
    }
    for (const row of blocked || []) {
        attention.push({
            type: "blocked",
            title: `${row.env || "Config"} không vào ${row.signal || "signal"}: ${String(row.message || "").slice(0, 140)}`,
            href: "/logs?kind=runtime&category=signal",
        });
    }
    for (const row of parseRows || []) {
        if (!row._id) continue;
        attention.push({
            type: "parse",
            title: `${row._id} lỗi parse ${row.count} lần trong 7 ngày`,
            href: "/signal-search?tab=stats",
        });
    }
    for (const row of removed || []) {
        attention.push({
            type: "removed",
            title: `${row.env || "Config"} bị gỡ ${row.signal || "signal"}: ${String(row.message || "").slice(0, 140)}`,
            href: "/signal-search?tab=stats",
        });
    }

    const mine = [...bots]
        .sort((a, b) => (profitByUser.get(b.username) || 0) - (profitByUser.get(a.username) || 0) || a.username.localeCompare(b.username))
        .slice(0, 5)
        .map((bot) => ({
            username: bot.username,
            active: bot.active !== false,
            configs: (bot.accounts || []).length,
            on: canConfig ? (onByUser.get(bot.username) || 0) : null,
            profitToday: canStats ? (profitByUser.get(bot.username) || 0) : null,
        }));

    return {
        bots: { active: bots.filter((bot) => bot.active !== false).length, total: bots.length },
        configs: canConfig ? { on: onCount, total: envs.length } : null,
        profitToday: canStats ? [...profitByUser.values()].reduce((sum, value) => sum + value, 0) : null,
        incomeToday: canStats ? (incomeRows?.[0]?.profit || 0) : null,
        attention: attention.slice(0, 8),
        mine,
    };
}

module.exports = { getDashboard };
