const UserAccount = require("../models/user-account");
const AccountConfig = require("../models/account-config");
const AccountStatic = require("../models/account-static");
const { PERMISSIONS } = require("../auth/access-control");
const { canAccessBot } = require("../middleware/auth");
const { httpError } = require("./http");
const { openTimeFilter, openTimeRange } = require("./open-time-range");

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_CHOICES = new Set([1, 3, 7, 30, 90]);
const MAX_SIGNALS = 20;
const MAX_ROWS = 100;
const SORTS = new Set(["recent", "profit", "winrate"]);

function signalNames(value) {
    return [...new Set(String(value || "").split(/[,\s]+/).map((item) => item.trim().toUpperCase()).filter(Boolean))];
}

function optionalNumber(value, label) {
    if (value === "" || value == null) return null;
    const n = Number(value);
    if (!Number.isFinite(n)) throw httpError(400, `${label} không hợp lệ`);
    return n;
}

function searchRange(input, now = new Date()) {
    if (!input.from && !input.to) {
        const days = Number(input.days || 30);
        if (!DAY_CHOICES.has(days)) throw httpError(400, "Khoảng thời gian không hợp lệ");
        return { from: new Date(now.getTime() - days * DAY_MS), to: null };
    }
    return openTimeRange(input, now);
}

async function searchConfigsBySignal(actor, input = {}) {
    const wanted = signalNames(input.signal);
    if (!wanted.length) throw httpError(400, "Thiếu signal");
    if (wanted.length > MAX_SIGNALS) throw httpError(400, "Tối đa 20 signal");
    const range = searchRange(input);
    const minWinRate = optionalNumber(input.minWinRate, "Win rate");
    const minTrades = optionalNumber(input.minTrades, "Số lệnh");
    const profit = optionalNumber(input.profit, "Lợi nhuận");
    const profitOp = input.profitOp === "lt" ? "lt" : "gt";
    const sort = SORTS.has(input.sort) ? input.sort : "recent";
    const text = String(input.q || "").trim().toLowerCase();
    if (minWinRate != null && (minWinRate < 0 || minWinRate > 100)) throw httpError(400, "Win rate phải từ 0 đến 100");
    if (minTrades != null && minTrades < 0) throw httpError(400, "Số lệnh không hợp lệ");

    const accounts = await UserAccount.find().select("username accounts ownerUserId visibility active").lean();
    const bots = accounts.filter((row) => canAccessBot(actor, row, PERMISSIONS.CONFIG_VIEW));
    const envOwners = new Map();
    for (const bot of bots) {
        for (const env of bot.accounts || []) {
            if (!envOwners.has(env)) envOwners.set(env, []);
            envOwners.get(env).push(bot);
        }
    }
    const envs = [...envOwners.keys()];
    if (!envs.length) return { rows: [], from: range.from, to: range.to };

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
    if (!matched.length) return { rows: [], from: range.from, to: range.to };

    const time = openTimeFilter(range);
    const stats = await AccountStatic.aggregate([
        {
            $match: {
                env: { $in: [...new Set(matched.map((row) => row.env))] },
                isPaper: { $ne: true },
                ...(time ? { openTime: time } : {}),
                $expr: { $in: [{ $toUpper: { $ifNull: ["$typeSignal", ""] } }, wanted] },
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
    const rows = matched
        .map((row) => {
            const stat = byEnv.get(row.env) || {};
            const trades = stat.trades || 0;
            const wins = stat.wins || 0;
            return {
                ...row,
                trades,
                profit: stat.profit || 0,
                wins,
                winRate: trades ? (wins / trades) * 100 : 0,
                lastTime: stat.lastTime || null,
            };
        })
        .filter((row) => {
            if (text && !`${row.username} ${row.env}`.toLowerCase().includes(text)) return false;
            if (minTrades != null && row.trades < minTrades) return false;
            if (minWinRate != null && row.winRate < minWinRate) return false;
            if (profit != null && (profitOp === "lt" ? row.profit >= profit : row.profit <= profit)) return false;
            return true;
        })
        .sort((a, b) => {
            if (sort === "profit") return (b.profit || 0) - (a.profit || 0);
            if (sort === "winrate") return (b.winRate || 0) - (a.winRate || 0) || (b.trades || 0) - (a.trades || 0);
            const left = a.lastTime ? new Date(a.lastTime).getTime() : 0;
            const right = b.lastTime ? new Date(b.lastTime).getTime() : 0;
            if (right !== left) return right - left;
            return (b.profit || 0) - (a.profit || 0);
        })
        .slice(0, MAX_ROWS);
    return { rows, from: range.from, to: range.to };
}

module.exports = { searchConfigsBySignal };
