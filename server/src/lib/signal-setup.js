const UserAccount = require("../models/user-account");
const AccountConfig = require("../models/account-config");
const AccountStatic = require("../models/account-static");
const FuturesProfit = require("../models/futures-profit");
const TelegramClient = require("../models/telegram-client");
const RuntimeLog = require("../models/runtime-log");
const { PERMISSIONS, hasPermission, scopeForPermission } = require("../auth/access-control");
const { canAccessBot } = require("../middleware/auth");
const { httpError } = require("./http");
const { requireBot } = require("./bot-directory");
const { getConfigDetail, updateConfigSummary } = require("./account-config-view");

const DAY_MS = 24 * 60 * 60 * 1000;

function signalTokens(value) {
    const raw = Array.isArray(value) ? value : String(value || "").split(/[,\s]+/);
    const seen = new Set();
    const items = [];
    for (const item of raw) {
        const token = String(item || "").trim().toUpperCase();
        if (!token) continue;
        if (token.length > 32 || !/^[A-Z0-9_-]+$/.test(token)) throw httpError(400, "Signal không hợp lệ");
        if (seen.has(token)) continue;
        seen.add(token);
        items.push(token);
    }
    if (!items.length) throw httpError(400, "Thiếu signal");
    if (items.length > 20) throw httpError(400, "Tối đa 20 signal");
    return items;
}

function mergeSignals(current, names, action) {
    const base = [];
    const seen = new Set();
    for (const item of current || []) {
        const token = String(item || "").trim().toUpperCase();
        if (!token || seen.has(token)) continue;
        seen.add(token);
        base.push(token);
    }
    if (action === "add") {
        for (const token of names) {
            if (seen.has(token)) continue;
            seen.add(token);
            base.push(token);
        }
        return base;
    }
    const drop = new Set(names);
    return base.filter((token) => !drop.has(token));
}

function roundMoney(value) {
    const n = Number(value) || 0;
    return Math.round(n * 100) / 100;
}

function startOfUtcDay(now = new Date()) {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function walletEnv(bot) {
    const accounts = (bot?.accounts || []).map((item) => String(item || "").trim()).filter(Boolean);
    const name = String(bot?.username || "").trim();
    const upper = new Set(accounts.map((item) => item.toUpperCase()));
    if (name && upper.has(name.toUpperCase())) return accounts.find((item) => item.toUpperCase() === name.toUpperCase()) || name;
    return accounts[0] || name;
}

function presentTrade(row) {
    const count = row.count || 0;
    return {
        username: row.username,
        env: row.env,
        signal: row.signal,
        count,
        winRate: count ? (row.wins / count) * 100 : 0,
        profit: roundMoney(row.profit),
    };
}

function foldTrades(rows, envUser, todayOnly) {
    const grouped = new Map();
    for (const row of rows || []) {
        if (todayOnly && row?._id?.today !== true) continue;
        const env = String(row?._id?.env || "").trim();
        const signal = String(row?._id?.signal || "").trim().toUpperCase();
        if (!env || !signal) continue;
        const username = envUser.get(env) || envUser.get(env.toUpperCase()) || "";
        const key = `${username || env}\n${env}\n${signal}`;
        const bucket = grouped.get(key) || {
            username,
            env,
            signal,
            count: 0,
            wins: 0,
            profit: 0,
        };
        bucket.count += row.count || 0;
        bucket.wins += row.wins || 0;
        bucket.profit += Number(row.profit) || 0;
        grouped.set(key, bucket);
    }
    return [...grouped.values()].map(presentTrade);
}

async function listPerformance(bots) {
    const envUser = new Map();
    const walletByUser = new Map();
    for (const bot of bots || []) {
        if (!bot?.username) continue;
        walletByUser.set(bot.username, walletEnv(bot));
        for (const env of bot.accounts || []) {
            const name = String(env || "").trim();
            if (!name) continue;
            if (!envUser.has(name)) envUser.set(name, bot.username);
            if (!envUser.has(name.toUpperCase())) envUser.set(name.toUpperCase(), bot.username);
        }
        if (!envUser.has(bot.username)) envUser.set(bot.username, bot.username);
    }
    const envs = [...envUser.keys()];
    const from = new Date(Date.now() - 7 * DAY_MS);
    const todayFrom = startOfUtcDay();
    const empty = { from, todayFrom, to: new Date(), accountLosses: [], todayLosing: [], losingSignals: [], lowWinRate: [] };
    if (!envs.length) return empty;
    const recent = {
        env: { $in: envs },
        isPaper: { $ne: true },
        $or: [{ closeTime: { $gte: from } }, { openTime: { $gte: from } }],
    };
    const [grouped, wallets] = await Promise.all([
        AccountStatic.aggregate([
            { $match: recent },
            { $group: {
                _id: {
                    env: "$env",
                    signal: "$typeSignal",
                    today: { $cond: [{ $or: [{ $gte: ["$closeTime", todayFrom] }, { $gte: ["$openTime", todayFrom] }] }, true, false] },
                },
                count: { $sum: 1 },
                wins: { $sum: { $cond: [{ $eq: ["$status", "WIN"] }, 1, 0] } },
                profit: { $sum: { $ifNull: ["$profit", 0] } },
            } },
        ]),
        FuturesProfit.find({
            env: { $in: [...new Set([...walletByUser.values(), ...walletByUser.keys()].flatMap((item) => {
                const name = String(item || "").trim();
                return name ? [name, name.toUpperCase()] : [];
            }))] },
            day: { $gte: todayFrom, $lt: new Date(todayFrom.getTime() + DAY_MS) },
        }).select("env profit").lean(),
    ]);
    const byLoss = (rows) => rows.filter((row) => row.profit < 0).sort((a, b) => a.profit - b.profit || b.count - a.count || a.username.localeCompare(b.username));
    const todayLosing = byLoss(foldTrades(grouped, envUser, true)).slice(0, 12);
    const week = foldTrades(grouped, envUser, false);
    const losingSignals = byLoss(week).slice(0, 12);
    const lowWinRate = week
        .filter((row) => row.count >= 3 && row.winRate < 50)
        .sort((a, b) => a.winRate - b.winRate || a.profit - b.profit)
        .slice(0, 12);
    const profitByEnv = new Map();
    for (const doc of wallets || []) {
        const key = String(doc?.env || "").toUpperCase();
        if (!key || profitByEnv.has(key)) continue;
        profitByEnv.set(key, roundMoney(doc.profit));
    }
    const accountLosses = [...walletByUser.entries()]
        .map(([username, env]) => {
            const walletKey = String(env || "").toUpperCase();
            const userKey = String(username || "").toUpperCase();
            const profit = profitByEnv.has(walletKey) ? profitByEnv.get(walletKey) : profitByEnv.has(userKey) ? profitByEnv.get(userKey) : null;
            const signals = todayLosing.filter((row) => row.username === username).slice(0, 5);
            return { username, env, profit, signals };
        })
        .filter((row) => row.profit != null && row.profit < 0)
        .sort((a, b) => a.profit - b.profit || a.username.localeCompare(b.username))
        .slice(0, 8);
    return { from, todayFrom, to: new Date(), accountLosses, todayLosing, losingSignals, lowWinRate };
}

function seesAll(actor) {
    return scopeForPermission(actor, PERMISSIONS.CONFIG_VIEW) === "all"
        || scopeForPermission(actor, PERMISSIONS.SIGNALS_HISTORY) === "all";
}

function isMine(actor, bot) {
    const username = bot?.username;
    if (!username || !actor) return false;
    const ownerUserId = bot.ownerUserId ? String(bot.ownerUserId) : "";
    if (ownerUserId && ownerUserId === String(actor.id || "")) return true;
    if (!ownerUserId && [actor.username, actor.email].filter(Boolean).includes(username)) return true;
    return (actor.botUsernames || []).includes(username);
}

function toChannel(channel) {
    const name = String(channel?.name || "").trim().toUpperCase();
    if (!name) return null;
    return { name, ocr: channel.ocr === true, photoFomo: channel.photoFomo === true };
}

async function listChannels(allowed) {
    const rows = await TelegramClient.find().select("channels.name channels.ocr channels.photoFomo").lean();
    const seen = new Map();
    for (const row of rows) {
        for (const channel of row.channels || []) {
            const item = toChannel(channel);
            if (!item || seen.has(item.name)) continue;
            if (allowed && !allowed.has(item.name)) continue;
            seen.set(item.name, item);
        }
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

async function listParseErrors(allowed) {
    const match = { category: "signal", source: "parse", at: { $gte: new Date(Date.now() - 7 * DAY_MS) } };
    if (allowed) {
        if (!allowed.size) return [];
        match.signal = { $in: [...allowed] };
    }
    const rows = await RuntimeLog.aggregate([
        { $match: match },
        { $sort: { at: -1 } },
        { $group: { _id: "$signal", count: { $sum: 1 }, lastAt: { $first: "$at" }, sample: { $first: "$message" } } },
        { $sort: { count: -1 } },
        { $limit: 30 },
    ]);
    return rows.map((row) => ({
        signal: row._id || "",
        count: row.count || 0,
        lastAt: row.lastAt || null,
        sample: String(row.sample || "").slice(0, 180),
    }));
}

async function listRemoved(envs, all) {
    const match = { category: "signal", source: "autoremove", at: { $gte: new Date(Date.now() - 14 * DAY_MS) } };
    if (!all) {
        if (!envs.length) return [];
        match.env = { $in: envs };
    }
    const rows = await RuntimeLog.find(match).sort({ at: -1 }).limit(50).select("at env signal message").lean();
    return rows.map((row) => ({
        at: row.at || null,
        env: row.env || "",
        signal: row.signal || "",
        message: String(row.message || "").slice(0, 180),
    }));
}

function buildSignalStats(docs, mineEnvs, channels, parseErrors, removed) {
    const channelNames = new Set(channels.map((row) => row.name));
    const parseCount = new Map(parseErrors.map((row) => [row.signal, row.count || 0]));
    const removedCount = new Map();
    for (const row of removed) {
        const signal = row.signal || "";
        removedCount.set(signal, (removedCount.get(signal) || 0) + 1);
    }
    const usageMap = new Map();
    for (const doc of docs) {
        if (!mineEnvs.has(doc.env)) continue;
        const on = doc.trade_config?.ON !== false;
        const autoRemove = doc.trade_config?.AUTO_REMOVE === true;
        for (const name of doc.signals || []) {
            const signal = String(name || "").trim().toUpperCase();
            if (!signal) continue;
            const row = usageMap.get(signal) || { signal, configs: 0, on: 0, autoRemove: 0 };
            row.configs += 1;
            if (on) row.on += 1;
            if (autoRemove) row.autoRemove += 1;
            usageMap.set(signal, row);
        }
    }
    const usage = [...usageMap.values()]
        .map((row) => ({
            ...row,
            channel: channelNames.has(row.signal),
            parseErrors: parseCount.get(row.signal) || 0,
            removed: removedCount.get(row.signal) || 0,
        }))
        .sort((a, b) => b.parseErrors - a.parseErrors || b.removed - a.removed || b.configs - a.configs || a.signal.localeCompare(b.signal));
    const used = new Set(usage.map((row) => row.signal));
    return {
        usage,
        orphanChannels: channels.filter((row) => !used.has(row.name)),
        summary: {
            channels: channels.length,
            signals: usage.length,
            withoutChannel: usage.filter((row) => !row.channel).length,
            parseErrors: parseErrors.reduce((total, row) => total + (row.count || 0), 0),
            removed: removed.length,
        },
    };
}

async function listSignalSetup(actor, input = {}) {
    if (!actor) throw httpError(401, "Chưa đăng nhập");
    if (!hasPermission(actor, PERMISSIONS.CONFIG_VIEW) && !hasPermission(actor, PERMISSIONS.SIGNALS_HISTORY)) {
        throw httpError(403, "Không có quyền");
    }
    const username = String(input.username || "").trim();
    const canViewConfig = hasPermission(actor, PERMISSIONS.CONFIG_VIEW);
    const accounts = canViewConfig
        ? await UserAccount.find().select("username accounts ownerUserId visibility active").lean()
        : [];
    const visible = accounts.filter((row) => canAccessBot(actor, row, PERMISSIONS.CONFIG_VIEW));
    const mine = visible.filter((row) => isMine(actor, row));
    const bots = mine
        .filter((row) => row.active !== false)
        .map((row) => ({ username: row.username, accounts: (row.accounts || []).length }))
        .sort((a, b) => a.username.localeCompare(b.username));
    const mineEnvs = new Set(mine.flatMap((row) => row.accounts || []));
    const envs = [...new Set(visible.flatMap((row) => row.accounts || []))];
    const docs = envs.length
        ? await AccountConfig.find({ env: { $in: envs } }).select("env signals trade_config.ON trade_config.AUTO_REMOVE").lean()
        : [];
    const catalogMap = new Map();
    for (const doc of docs) {
        if (!mineEnvs.has(doc.env)) continue;
        for (const name of doc.signals || []) {
            const signal = String(name || "").trim().toUpperCase();
            if (!signal) continue;
            const row = catalogMap.get(signal) || { signal, configs: 0 };
            row.configs += 1;
            catalogMap.set(signal, row);
        }
    }
    const catalog = [...catalogMap.values()].sort((a, b) => b.configs - a.configs || a.signal.localeCompare(b.signal));
    const all = seesAll(actor);
    const allowed = all ? null : new Set(catalog.map((row) => row.signal));
    let selected = null;
    let accountRows = [];
    if (username) {
        if (!canViewConfig) throw httpError(403, "Không có quyền");
        selected = await requireBot(actor, username, PERMISSIONS.CONFIG_VIEW);
        if (!isMine(actor, selected)) throw httpError(403, "Chỉ sửa signal của user đang sở hữu hoặc được gán");
        const owned = new Set(selected.accounts || []);
        accountRows = docs
            .filter((doc) => owned.has(doc.env))
            .map((doc) => ({
                env: doc.env,
                on: doc.trade_config?.ON !== false,
                autoRemove: doc.trade_config?.AUTO_REMOVE === true,
                signals: (doc.signals || []).map((item) => String(item).toUpperCase()),
            }))
        for (const env of selected.accounts || []) {
            if (accountRows.some((row) => row.env === env)) continue;
            accountRows.push({ env, on: false, autoRemove: false, signals: [] });
        }
        accountRows.sort((a, b) => a.env.localeCompare(b.env));
    }
    const [channels, parseErrors, removed] = await Promise.all([
        listChannels(allowed),
        listParseErrors(allowed),
        listRemoved(envs, all),
    ]);
    const stats = buildSignalStats(docs, mineEnvs, channels, parseErrors, removed);
    const performance = hasPermission(actor, PERMISSIONS.STATISTICS_VIEW)
        ? await listPerformance(visible)
        : null;
    return {
        bots,
        channels,
        catalog,
        parseErrors,
        removed,
        performance,
        ...stats,
        username: selected?.username || "",
        editable: selected ? canAccessBot(actor, selected, PERMISSIONS.CONFIG_EDIT) : false,
        accounts: accountRows,
    };
}

async function applySignals(actor, username, body) {
    const action = body?.action === "remove" ? "remove" : body?.action === "add" ? "add" : "";
    if (!action) throw httpError(400, "Chọn thêm hoặc xoá");
    const names = signalTokens(body?.signals);
    const bot = await requireBot(actor, username, PERMISSIONS.CONFIG_EDIT);
    if (!isMine(actor, bot)) throw httpError(403, "Chỉ sửa signal của user đang sở hữu hoặc được gán");
    const owned = new Set(bot.accounts || []);
    const envs = [...new Set((Array.isArray(body?.envs) ? body.envs : []).map((item) => String(item || "").trim()).filter(Boolean))];
    if (!envs.length) throw httpError(400, "Chưa chọn config");
    if (envs.length > 40) throw httpError(400, "Chọn tối đa 40 config");
    const docs = await AccountConfig.find({ env: { $in: envs } }).select("env signals").lean();
    const byEnv = new Map(docs.map((doc) => [doc.env, doc]));
    const updated = [];
    const failed = [];
    for (const env of envs) {
        if (!owned.has(env)) {
            failed.push({ env, error: "Config không thuộc user bot này" });
            continue;
        }
        const doc = byEnv.get(env);
        if (!doc) {
            failed.push({ env, error: "Không tìm thấy config" });
            continue;
        }
        const next = mergeSignals(doc.signals, names, action);
        const current = mergeSignals(doc.signals, [], "add");
        if (next.join("\n") === current.join("\n")) {
            updated.push({ env, changed: false, signals: next });
            continue;
        }
        try {
            const before = await getConfigDetail(actor, username, env, PERMISSIONS.CONFIG_EDIT);
            const after = await updateConfigSummary(actor, username, env, { signals: next });
            updated.push({ env, changed: true, before, after, signals: next });
        } catch (error) {
            console.error("[applySignals]", env, error?.status || error?.name || "error");
            failed.push({ env, error: error?.message || "Không sửa được" });
        }
    }
    if (!updated.length) throw httpError(400, failed[0]?.error || "Không sửa được config nào");
    return { updated, failed, action };
}

module.exports = { signalTokens, mergeSignals, listSignalSetup, applySignals };
