const UserAccount = require("../models/user-account");
const AccountConfig = require("../models/account-config");
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
    return {
        bots,
        channels,
        catalog,
        parseErrors,
        removed,
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
