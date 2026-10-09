const UserAccount = require("../models/user-account");
const AccountConfig = require("../models/account-config");
const AccountStatic = require("../models/account-static");
const FuturesProfit = require("../models/futures-profit");
const UserApi = require("../models/user-api");
const RuntimeLog = require("../models/runtime-log");
const { PERMISSIONS, hasPermission } = require("../auth/access-control");
const { httpError } = require("./http");
const { ledgerEnv } = require("./account-ledger");
const { attentionPackage } = require("./dashboard-brief");

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

function moneyText(value) {
    const n = Math.round((Number(value) || 0) * 100) / 100;
    const abs = Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
    return `${n < 0 ? "-" : ""}${abs}$`;
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
    const [profitRows, incomeRows, signalRows, apiRows, blocked, removed] = await Promise.all([
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
                { $group: { _id: "$env", profit: { $sum: { $ifNull: ["$profit", 0] } } } },
            ])
            : [],
        canStats && envFilter
            ? AccountStatic.aggregate([
                { $match: {
                    ...envFilter,
                    isPaper: { $ne: true },
                    $or: [{ closeTime: { $gte: dayStart } }, { openTime: { $gte: dayStart } }],
                } },
                { $group: {
                    _id: { env: "$env", signal: "$typeSignal" },
                    count: { $sum: 1 },
                    profit: { $sum: { $ifNull: ["$profit", 0] } },
                } },
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
        canSignals && envFilter
            ? RuntimeLog.find({
                category: "signal",
                source: "autoremove",
                at: { $gte: new Date(now.getTime() - 14 * DAY_MS) },
                ...envFilter,
            }).sort({ at: -1 }).limit(2).select("at env signal message").lean()
            : [],
    ]);

    const signalLosing = (signalRows || [])
        .map((row) => {
            const env = String(row?._id?.env || "").trim();
            const signal = String(row?._id?.signal || "").trim().toUpperCase();
            const bot = ownerOf(bots, env);
            const profit = Math.round((Number(row?.profit) || 0) * 100) / 100;
            if (!bot || !env || !signal || profit >= 0) return null;
            return { username: bot.username, env, signal, count: row.count || 0, profit };
        })
        .filter(Boolean)
        .sort((a, b) => a.profit - b.profit || b.count - a.count)
        .slice(0, 6);
    const incomeByEnv = new Map((incomeRows || []).map((row) => [envKey(row._id), Number(row.profit) || 0]));
    const accountLosing = bots
        .map((bot) => {
            const key = envKey(ledgerEnv(bot));
            const userKey = envKey(bot.username);
            if (!incomeByEnv.has(key) && !incomeByEnv.has(userKey)) return null;
            const profit = Math.round((incomeByEnv.has(key) ? incomeByEnv.get(key) : incomeByEnv.get(userKey)) * 100) / 100;
            if (profit >= 0) return null;
            const why = signalLosing.filter((row) => row.username === bot.username).slice(0, 4);
            const whyText = why.length
                ? ` Signal lỗ: ${why.map((row) => `${row.env} · ${row.signal} ${moneyText(row.profit)}`).join(", ")}.`
                : " Chưa thấy signal live lỗ trong ngày, cần xem income.";
            return {
                type: "account",
                username: bot.username,
                title: `${bot.username} lỗ ${moneyText(profit)} trên tài khoản hôm nay.${whyText}`,
                href: `/ledger?username=${encodeURIComponent(bot.username)}`,
                profit,
                env: ledgerEnv(bot),
                signals: why.map((row) => ({ env: row.env, signal: row.signal, count: row.count, profit: row.profit })),
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.profit - b.profit)
        .slice(0, 4);
    const signalItems = signalLosing.map((row) => ({
        type: "loss",
        title: `${row.username} · ${row.env} · ${row.signal} lỗ ${moneyText(row.profit)} hôm nay, ${row.count} lệnh`,
        href: `/bots/${encodeURIComponent(row.username)}/accounts/${encodeURIComponent(row.env)}`,
        username: row.username,
        env: row.env,
        signal: row.signal,
        count: row.count,
        profit: row.profit,
    }));
    const profitByEnv = new Map((profitRows || []).map((row) => [envKey(row._id), row.profit || 0]));
    const profitByUser = new Map();
    for (const [env, profit] of profitByEnv) {
        const bot = ownerOf(bots, env);
        if (!bot) continue;
        profitByUser.set(bot.username, (profitByUser.get(bot.username) || 0) + profit);
    }
    const onByUser = new Map();
    const attention = [];
    const configsOnWithoutSignal = [];
    const missingApiKey = [];
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
        if (canConfig && on && !names.length && configsOnWithoutSignal.length < 3) {
            const item = {
                type: "config",
                title: `${bot.username}/${doc.env} đang bật nhưng chưa có signal`,
                href: `/bots/${encodeURIComponent(bot.username)}/accounts/${encodeURIComponent(doc.env)}`,
                username: bot.username,
                env: doc.env,
            };
            configsOnWithoutSignal.push(item);
            attention.push(item);
        }
    }
    const keyed = new Set((apiRows || []).filter((row) => row.hasApiKey).map((row) => row.username));
    if (canKeys) {
        for (const bot of bots) {
            if (keyed.has(bot.username)) continue;
            if (missingApiKey.length >= 3) break;
            const item = {
                type: "api",
                title: `${bot.username} chưa có API key`,
                href: `/user-apis/${encodeURIComponent(bot.username)}`,
                username: bot.username,
            };
            missingApiKey.push(item);
            attention.push(item);
        }
    }
    for (const row of blocked || []) {
        attention.push({
            type: "blocked",
            title: `${row.env || "Config"} không vào ${row.signal || "signal"}: ${String(row.message || "").slice(0, 140)}`,
            href: "/logs?kind=runtime&category=signal",
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

    const profitToday = canStats ? [...profitByUser.values()].reduce((sum, value) => sum + value, 0) : null;
    const incomeToday = canStats ? (incomeRows || []).reduce((sum, row) => sum + (Number(row.profit) || 0), 0) : null;
    const listed = [...accountLosing, ...signalItems, ...attention].slice(0, 12);
    const facts = {
        day: "UTC",
        profitToday,
        incomeToday,
        walletLosses: accountLosing.map((row) => ({
            username: row.username,
            env: row.env,
            profit: row.profit,
            signals: row.signals,
            href: row.href,
        })),
        signalLosses: signalItems.map((row) => ({
            username: row.username,
            env: row.env,
            signal: row.signal,
            count: row.count,
            profit: row.profit,
            href: row.href,
        })),
        configsOnWithoutSignal: configsOnWithoutSignal.map((row) => ({ username: row.username, env: row.env, href: row.href })),
        missingApiKey: missingApiKey.map((row) => ({ username: row.username, href: row.href })),
        blocked: (blocked || []).map((row) => ({
            env: row.env || "",
            signal: row.signal || "",
            message: String(row.message || "").slice(0, 140),
            href: "/logs?kind=runtime&category=signal",
        })),
        removed: (removed || []).map((row) => ({
            env: row.env || "",
            signal: row.signal || "",
            message: String(row.message || "").slice(0, 140),
            href: "/signal-search?tab=stats",
        })),
    };
    return {
        bots: { active: bots.filter((bot) => bot.active !== false).length, total: bots.length },
        configs: canConfig ? { on: onCount, total: envs.length } : null,
        profitToday,
        incomeToday,
        attention: listed.map(({ type, title, href }) => ({ type, title, href })),
        mine,
        ai: attentionPackage(facts),
    };
}

module.exports = { getDashboard };
