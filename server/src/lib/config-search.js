const UserAccount = require("../models/user-account");
const AccountConfig = require("../models/account-config");
const AccountStatic = require("../models/account-static");
const { PERMISSIONS } = require("../auth/access-control");
const { canAccessBot } = require("../middleware/auth");
const { httpError } = require("./http");

const RECENT_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_SIGNALS = 20;
const MAX_ROWS = 100;

function signalNames(value) {
    return [...new Set(String(value || "").split(/[,\s]+/).map((item) => item.trim().toUpperCase()).filter(Boolean))];
}

async function searchConfigsBySignal(actor, input = {}) {
    const wanted = signalNames(input.signal);
    if (!wanted.length) throw httpError(400, "Thiếu signal");
    if (wanted.length > MAX_SIGNALS) throw httpError(400, "Tối đa 20 signal");

    const rows = await UserAccount.find().select("username accounts ownerUserId visibility active").lean();
    const bots = rows.filter((row) => canAccessBot(actor, row, PERMISSIONS.CONFIG_VIEW));
    const envOwners = new Map();
    for (const bot of bots) {
        for (const env of bot.accounts || []) {
            if (!envOwners.has(env)) envOwners.set(env, []);
            envOwners.get(env).push(bot);
        }
    }
    const envs = [...envOwners.keys()];
    if (!envs.length) return [];

    const configs = await AccountConfig.find({ env: { $in: envs } }).select("env signals").lean();
    const matched = [];
    const wantedSet = new Set(wanted);
    for (const doc of configs) {
        const signals = (doc.signals || []).map((item) => String(item));
        const hit = signals.filter((item) => wantedSet.has(item.toUpperCase()));
        if (!hit.length) continue;
        for (const bot of envOwners.get(doc.env) || []) {
            matched.push({
                username: bot.username,
                env: doc.env,
                signals,
                matched: hit,
                canEdit: canAccessBot(actor, bot, PERMISSIONS.CONFIG_EDIT),
            });
        }
    }
    if (!matched.length) return [];

    const stats = await AccountStatic.aggregate([
        {
            $match: {
                env: { $in: [...new Set(matched.map((row) => row.env))] },
                isPaper: { $ne: true },
                openTime: { $gte: new Date(Date.now() - RECENT_MS) },
            },
        },
        {
            $group: {
                _id: "$env",
                trades: { $sum: 1 },
                profit: { $sum: { $ifNull: ["$profit", 0] } },
                wins: { $sum: { $cond: [{ $gt: ["$profit", 0] }, 1, 0] } },
                lastTime: { $max: { $ifNull: ["$closeTime", "$openTime"] } },
            },
        },
    ]);
    const byEnv = new Map(stats.map((row) => [row._id, row]));
    return matched
        .map((row) => {
            const stat = byEnv.get(row.env) || {};
            return {
                ...row,
                trades: stat.trades || 0,
                profit: stat.profit || 0,
                wins: stat.wins || 0,
                lastTime: stat.lastTime || null,
            };
        })
        .sort((a, b) => {
            const left = a.lastTime ? new Date(a.lastTime).getTime() : 0;
            const right = b.lastTime ? new Date(b.lastTime).getTime() : 0;
            if (right !== left) return right - left;
            return (b.profit || 0) - (a.profit || 0);
        })
        .slice(0, MAX_ROWS);
}

module.exports = { searchConfigsBySignal };
