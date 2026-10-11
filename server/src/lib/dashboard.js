const UserAccount = require("../models/user-account");
const AccountConfig = require("../models/account-config");
const AccountStatic = require("../models/account-static");
const FuturesProfit = require("../models/futures-profit");
const UserApi = require("../models/user-api");
const RuntimeLog = require("../models/runtime-log");
const ProcessHeartbeat = require("../models/process-heartbeat");
const { PERMISSIONS, hasPermission, scopeForPermission } = require("../auth/access-control");
const { httpError } = require("./http");
const { ledgerEnv } = require("./account-ledger");
const { attentionPackage } = require("./dashboard-brief");

const DAY_MS = 24 * 60 * 60 * 1000;
const HEARTBEAT_MS = 90 * 1000;
const MINE_LIMIT = 10;
const TOP_RISK = 5;
const SERIES_DAYS = 7;
const ACTIVITY_LIMIT = 8;
/** Mặc định; override bằng DASHBOARD_* trong .env */
const WALLET_ATTENTION_MIN = -5;
const WALLET_CRITICAL = -50;
const SIGNAL_ATTENTION_MIN = -5;
const UPNL_CRITICAL = -100;
const DEFAULT_CACHE_MS = 30 * 1000;
const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
const CREDENTIAL_RE = /invalid api|api-key|api key|signature|credential|-2014|-2015|权限|API-key format/i;

const dashboardCache = new Map();

function numEnv(name, fallback) {
    const n = Number(process.env[name]);
    return Number.isFinite(n) ? n : fallback;
}

function severityThresholds(deps = {}) {
    return {
        walletAttentionMin: deps.walletAttentionMin ?? numEnv("DASHBOARD_WALLET_ATTENTION_MIN", WALLET_ATTENTION_MIN),
        walletCritical: deps.walletCritical ?? numEnv("DASHBOARD_WALLET_CRITICAL", WALLET_CRITICAL),
        signalAttentionMin: deps.signalAttentionMin ?? numEnv("DASHBOARD_SIGNAL_ATTENTION_MIN", SIGNAL_ATTENTION_MIN),
        upnlCritical: deps.upnlCritical ?? numEnv("DASHBOARD_UPNL_CRITICAL", UPNL_CRITICAL),
    };
}

function cacheTtlMs(deps = {}) {
    if (deps.cacheTtlMs != null) return Math.max(0, Number(deps.cacheTtlMs) || 0);
    return Math.max(0, numEnv("DASHBOARD_CACHE_MS", DEFAULT_CACHE_MS));
}

function cacheKey(actor) {
    return [
        String(actor?.id || ""),
        [...(actor?.permissions || [])].sort().join(","),
        [...(actor?.botUsernames || [])].sort().join(","),
    ].join("|");
}

function utcDayKey(date) {
    const d = date instanceof Date ? date : new Date(date);
    return d.toISOString().slice(0, 10);
}

function dayKeysBack(end, count) {
    const keys = [];
    const start = startOfUtcDay(end);
    for (let i = count - 1; i >= 0; i -= 1) {
        keys.push(utcDayKey(new Date(start.getTime() - i * DAY_MS)));
    }
    return keys;
}

function clearDashboardCache() {
    dashboardCache.clear();
}

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

function round2(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
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

function beatAgeMs(at, now) {
    const time = new Date(at).getTime();
    return Number.isFinite(time) ? now.getTime() - time : null;
}

function beatFresh(beat, now) {
    const age = beatAgeMs(beat?.at, now);
    return age != null && age <= HEARTBEAT_MS;
}

function buildHealth(bots, beats, now) {
    const rows = [];
    let ok = 0;
    let stale = 0;
    let off = 0;
    let unknown = 0;
    for (const bot of bots) {
        const username = bot.username;
        const displayActive = bot.active !== false;
        const related = (beats || []).filter((beat) => {
            const run = Array.isArray(beat.run) ? beat.run : [];
            if (!run.map((item) => String(item || "").trim()).includes(username)) return false;
            return beat?.flags?.trader === true || beat?.flags?.monitor === true;
        });
        let process = "unknown";
        let lastBeatAt = null;
        if (!displayActive) {
            process = "off";
            off += 1;
        } else if (!related.length) {
            process = "unknown";
            unknown += 1;
        } else {
            const freshOnes = related.filter((beat) => beatFresh(beat, now));
            const newest = [...related].sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0))[0];
            lastBeatAt = newest?.at || null;
            if (freshOnes.length) {
                const mqttBad = freshOnes.some((beat) => beat.flags?.trader === true && beat.mqttConnected === false);
                process = mqttBad ? "degraded" : "ok";
                ok += 1;
            } else {
                process = "stale";
                stale += 1;
            }
        }
        rows.push({
            username,
            displayActive,
            process,
            lastBeatAt: lastBeatAt ? new Date(lastBeatAt).toISOString() : null,
        });
    }
    return {
        ok,
        stale,
        off,
        unknown,
        thresholdMs: HEARTBEAT_MS,
        bots: rows,
    };
}

function positionSide(row) {
    const mode = String(row?.positionSide || "BOTH").toUpperCase();
    if (mode === "LONG" || mode === "SHORT") return mode;
    const amt = Number(row?.positionAmt);
    if (!Number.isFinite(amt) || amt === 0) return "";
    return amt < 0 ? "SHORT" : "LONG";
}

function buildOpenRisk(usernames, books) {
    const names = Array.isArray(usernames) ? usernames : [];
    if (!names.length) {
        return {
            available: true,
            positions: 0,
            unrealized: 0,
            notional: 0,
            staleBook: false,
            booksFound: 0,
            top: [],
            byUser: {},
        };
    }
    const found = books && typeof books === "object" ? books : {};
    const open = [];
    let staleBook = false;
    let booksFound = 0;
    for (const username of names) {
        const book = found[username];
        if (!book || !Array.isArray(book.positions)) continue;
        booksFound += 1;
        if (book.stale === true || book.status === "stale") staleBook = true;
        for (const row of book.positions) {
            const qty = Math.abs(Number(row?.positionAmt) || 0);
            if (!(qty > 0)) continue;
            const side = positionSide(row);
            const symbol = String(row?.symbol || "").toUpperCase();
            if (!symbol || !side) continue;
            const mark = Number(row?.markPrice);
            const unrealized = row?.unRealizedProfit == null || row?.unRealizedProfit === ""
                ? null
                : round2(row.unRealizedProfit);
            const notional = Number.isFinite(mark) ? round2(qty * mark) : null;
            open.push({
                username,
                env: username,
                symbol,
                side,
                unrealized,
                notional,
                href: `/positions?account=${encodeURIComponent(username)}`,
            });
        }
    }
    const byUser = {};
    for (const row of open) {
        const prev = byUser[row.username] || { unrealized: 0, positions: 0 };
        prev.positions += 1;
        prev.unrealized = round2(prev.unrealized + (row.unrealized || 0));
        byUser[row.username] = prev;
    }
    const top = [...open]
        .sort((a, b) => {
            const aAbs = Math.abs(a.unrealized == null ? 0 : a.unrealized);
            const bAbs = Math.abs(b.unrealized == null ? 0 : b.unrealized);
            return bAbs - aAbs || (a.unrealized || 0) - (b.unrealized || 0);
        })
        .slice(0, TOP_RISK)
        .map((row) => ({
            username: row.username,
            env: row.env,
            symbol: row.symbol,
            side: row.side,
            unrealized: row.unrealized,
            href: row.href,
        }));
    return {
        available: booksFound > 0,
        positions: open.length,
        unrealized: round2(open.reduce((sum, row) => sum + (row.unrealized || 0), 0)),
        notional: round2(open.reduce((sum, row) => sum + (row.notional || 0), 0)),
        staleBook,
        booksFound,
        top,
        byUser,
    };
}

function withSeverity(item, severity) {
    return { ...item, severity };
}

function sortAttention(items) {
    return [...items].sort((a, b) => {
        const rank = (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9);
        if (rank) return rank;
        const ap = a.profit == null ? 0 : a.profit;
        const bp = b.profit == null ? 0 : b.profit;
        return ap - bp;
    });
}

/**
 * Phân loại lý do NOT OPEN từ bot.
 * noise = hành vi bình thường (đã có vị thế, config tắt…) — không đưa vào việc cần xử lý.
 * filter = lọc theo config (blacklist, max position…) — gom tóm tắt, không dump log thô.
 * action = lỗi/bất thường cần xem.
 */
function classifySkipReason(message) {
    const text = String(message || "");
    if (/Position\s+\S+\s+is open/i.test(text)) {
        return { kind: "noise", code: "already_open", label: "đã có vị thế" };
    }
    if (/config\s+\S+\s+is off|is off\b/i.test(text) && /NOT OPEN|config/i.test(text)) {
        return { kind: "noise", code: "config_off", label: "config tắt" };
    }
    if (/COPY\.ON\s*=\s*false|Not open .+ COPY\.ON/i.test(text)) {
        return { kind: "noise", code: "copy_off", label: "COPY tắt" };
    }
    if (/blacklist/i.test(text)) {
        return { kind: "filter", code: "blacklist", label: "blacklist" };
    }
    if (/whitelist|WL=/i.test(text)) {
        return { kind: "filter", code: "whitelist", label: "không trong whitelist" };
    }
    if (/Max position/i.test(text)) {
        return { kind: "filter", code: "max_position", label: "đủ max position" };
    }
    if (/symbolType|SYMBOL_TYPES/i.test(text)) {
        return { kind: "filter", code: "symbol_type", label: "lọc symbolType" };
    }
    if (/current risk/i.test(text)) {
        return { kind: "filter", code: "risk", label: "lọc risk" };
    }
    if (CREDENTIAL_RE.test(text) || /insufficient|margin|balance|notional|-2019|-4164|-2027/i.test(text)) {
        return { kind: "action", code: "exchange", label: "lỗi sàn / số dư" };
    }
    if (/NOT OPEN/i.test(text) && text.trim()) {
        return { kind: "action", code: "other", label: "không mở được" };
    }
    return { kind: "action", code: "other", label: "cần kiểm tra" };
}

function attentionKey(item) {
    return [item.type, item.username || "", item.env || "", item.signal || "", item.code || "", item.href || ""]
        .join("|")
        .toLowerCase();
}

function dedupeAttention(items) {
    const seen = new Set();
    const out = [];
    for (const item of items) {
        const key = attentionKey(item);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
    }
    return out;
}

function buildSkipAttention(rows, bots) {
    const actionable = [];
    const filterBuckets = new Map();
    let noiseCount = 0;
    for (const row of rows || []) {
        const env = String(row.env || "").trim();
        const signal = String(row.signal || "").trim().toUpperCase();
        const bot = ownerOf(bots, env);
        if (!bot || !env) continue;
        const reason = classifySkipReason(row.message);
        if (reason.kind === "noise") {
            noiseCount += 1;
            continue;
        }
        if (reason.kind === "filter") {
            const key = `${bot.username}|${env}|${reason.code}`;
            const prev = filterBuckets.get(key) || {
                username: bot.username,
                env,
                code: reason.code,
                label: reason.label,
                signal,
                count: 0,
            };
            prev.count += 1;
            if (signal) prev.signal = signal;
            filterBuckets.set(key, prev);
            continue;
        }
        actionable.push(withSeverity({
            type: "blocked",
            code: reason.code,
            username: bot.username,
            env,
            signal,
            title: `${bot.username}/${env}${signal ? ` · ${signal}` : ""} ${reason.label}: ${String(row.message || "").replace(/^[^:]+:\s*/, "").slice(0, 100)}`,
            href: "/logs?kind=runtime&category=signal",
        }, "medium"));
    }
    const filterItems = [...filterBuckets.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, 3)
        .map((row) => withSeverity({
            type: "filter",
            code: row.code,
            username: row.username,
            env: row.env,
            signal: row.signal,
            title: `${row.username}/${row.env} bỏ qua signal (${row.label}${row.count > 1 ? `, ${row.count} lần` : ""}) — xem Config hoặc Lịch sử`,
            href: `/config-lab/${encodeURIComponent(row.username)}/${encodeURIComponent(row.env)}`,
        }, "low"));
    return { actionable: dedupeAttention(actionable).slice(0, 3), filterItems, noiseCount };
}

async function computeDashboard(actor, now = new Date(), deps = {}) {
    if (!actor) throw httpError(401, "Chưa đăng nhập");
    const limits = severityThresholds(deps);
    const canBots = hasPermission(actor, PERMISSIONS.BOTS_VIEW);
    const canConfig = hasPermission(actor, PERMISSIONS.CONFIG_VIEW);
    const canStats = hasPermission(actor, PERMISSIONS.STATISTICS_VIEW);
    const canKeys = hasPermission(actor, PERMISSIONS.CREDENTIALS_VIEW);
    const canLogs = hasPermission(actor, PERMISSIONS.LOGS_VIEW);
    const canPositions = hasPermission(actor, PERMISSIONS.POSITIONS_VIEW);
    const canSignals = canConfig || hasPermission(actor, PERMISSIONS.SIGNALS_HISTORY);
    const canSystem = canLogs && scopeForPermission(actor, PERMISSIONS.LOGS_VIEW) === "all";
    const healthHref = canSystem ? "/system" : canLogs ? "/logs?kind=runtime" : "/bots";
    const empty = {
        asOf: now.toISOString(),
        day: "UTC",
        bots: null,
        configs: null,
        profitToday: null,
        incomeToday: null,
        closedToday: null,
        compare: null,
        series: null,
        activity: [],
        openRisk: null,
        health: null,
        attention: [],
        mine: [],
        thresholds: limits,
        ai: attentionPackage({ day: "UTC" }),
    };
    if (!canBots) return empty;

    const UserAccountModel = deps.UserAccount || UserAccount;
    const AccountConfigModel = deps.AccountConfig || AccountConfig;
    const AccountStaticModel = deps.AccountStatic || AccountStatic;
    const FuturesProfitModel = deps.FuturesProfit || FuturesProfit;
    const UserApiModel = deps.UserApi || UserApi;
    const RuntimeLogModel = deps.RuntimeLog || RuntimeLog;
    const HeartbeatModel = deps.Heartbeat || ProcessHeartbeat;
    const readExchangeBooks = deps.readExchangeBooks
        || (() => {
            try {
                return require("./position-live").readExchangeBooks;
            } catch {
                return async () => ({});
            }
        })();

    const rows = await UserAccountModel.find().select("username accounts ownerUserId visibility active").lean();
    const bots = rows.filter((bot) => isMine(actor, bot) && bot.username);
    const envs = [...new Set(bots.flatMap((bot) => bot.accounts || []).filter(Boolean))];
    const envFilter = envs.length ? { env: { $in: envs } } : null;
    const dayStart = startOfUtcDay(now);
    const weekStart = new Date(dayStart.getTime() - (SERIES_DAYS - 1) * DAY_MS);
    const todayKey = utcDayKey(dayStart);
    const yesterdayKey = utcDayKey(new Date(dayStart.getTime() - DAY_MS));
    const seriesKeys = dayKeysBack(now, SERIES_DAYS);
    const futuresEnvs = [...new Set(envs.flatMap((item) => [item, envKey(item)]).filter(Boolean))];
    const usernames = bots.map((bot) => bot.username);

    const configs = (canConfig || canSignals) && envFilter
        ? await AccountConfigModel.find(envFilter).select("env signals trade_config.ON").lean()
        : [];

    const [weekProfitRows, weekIncomeRows, signalRows, apiRows, blocked, removed, exchangeLogs, recentCloses, beats, books] = await Promise.all([
        canStats && envFilter
            ? AccountStaticModel.aggregate([
                { $match: { ...envFilter, isPaper: false, $expr: { $and: [
                    { $gte: [{ $ifNull: ["$closeTime", "$openTime"] }, weekStart] },
                    { $lte: [{ $ifNull: ["$closeTime", "$openTime"] }, now] },
                ] } } },
                { $group: {
                    _id: {
                        env: "$env",
                        day: {
                            $dateToString: {
                                format: "%Y-%m-%d",
                                date: { $ifNull: ["$closeTime", "$openTime"] },
                                timezone: "UTC",
                            },
                        },
                    },
                    profit: { $sum: { $ifNull: ["$profit", 0] } },
                    trades: { $sum: 1 },
                    wins: {
                        $sum: {
                            $cond: [
                                { $eq: [{ $toUpper: { $ifNull: ["$status", ""] } }, "WIN"] },
                                1,
                                0,
                            ],
                        },
                    },
                    losses: {
                        $sum: {
                            $cond: [
                                { $in: [{ $toUpper: { $ifNull: ["$status", ""] } }, ["LOSS", "LOSE"]] },
                                1,
                                0,
                            ],
                        },
                    },
                } },
            ])
            : [],
        canStats && futuresEnvs.length
            ? FuturesProfitModel.aggregate([
                { $match: { env: { $in: futuresEnvs }, day: { $gte: weekStart, $lte: now } } },
                { $group: {
                    _id: {
                        env: "$env",
                        day: { $dateToString: { format: "%Y-%m-%d", date: "$day", timezone: "UTC" } },
                    },
                    profit: { $sum: { $ifNull: ["$profit", 0] } },
                } },
            ])
            : [],
        canStats && envFilter
            ? AccountStaticModel.aggregate([
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
            ? UserApiModel.aggregate([
                { $match: { username: { $in: usernames } } },
                { $project: { _id: 0, username: 1, hasApiKey: hasTextExpr("api_key") } },
            ])
            : [],
        canLogs && envFilter
            ? RuntimeLogModel.find({
                category: "signal",
                source: "callHandleSignalBot",
                at: { $gte: new Date(now.getTime() - 2 * DAY_MS) },
                ...envFilter,
            }).sort({ at: -1 }).limit(40).select("at env signal message").lean()
            : [],
        canSignals && envFilter
            ? RuntimeLogModel.find({
                category: "signal",
                source: "autoremove",
                at: { $gte: new Date(now.getTime() - 14 * DAY_MS) },
                ...envFilter,
            }).sort({ at: -1 }).limit(8).select("at env signal message").lean()
            : [],
        canLogs && envFilter
            ? RuntimeLogModel.find({
                category: "exchange",
                at: { $gte: new Date(now.getTime() - DAY_MS) },
                ...envFilter,
            }).sort({ at: -1 }).limit(12).select("at env message").lean()
            : [],
        canStats && envFilter
            ? AccountStaticModel.find({
                ...envFilter,
                isPaper: false,
                closeTime: { $gte: new Date(now.getTime() - 2 * DAY_MS), $lte: now },
            }).sort({ closeTime: -1 }).limit(6).select("env typeSignal symbol side profit status closeTime").lean()
            : [],
        usernames.length
            ? HeartbeatModel.find({
                run: { $in: usernames },
                $or: [{ "flags.trader": true }, { "flags.monitor": true }],
            }).select("at run flags mqttConnected").lean()
            : [],
        canPositions && usernames.length
            ? Promise.resolve()
                .then(() => readExchangeBooks(usernames))
                .catch((error) => {
                    console.error("[getDashboard]", error.message || error);
                    return null;
                })
            : null,
    ]);

    const health = buildHealth(bots, beats || [], now);
    const healthByUser = new Map(health.bots.map((row) => [row.username, row]));
    const openRisk = canPositions
        ? (books == null
            ? {
                available: false,
                positions: 0,
                unrealized: null,
                notional: null,
                staleBook: false,
                booksFound: 0,
                top: [],
                byUser: {},
            }
            : buildOpenRisk(usernames, books))
        : null;

    const signalLosing = (signalRows || [])
        .map((row) => {
            const env = String(row?._id?.env || "").trim();
            const signal = String(row?._id?.signal || "").trim().toUpperCase();
            const bot = ownerOf(bots, env);
            const profit = round2(row?.profit);
            if (!bot || !env || !signal || profit >= 0) return null;
            return { username: bot.username, env, signal, count: row.count || 0, profit };
        })
        .filter(Boolean)
        .sort((a, b) => a.profit - b.profit || b.count - a.count)
        .slice(0, 6);
    const incomeTodayByEnv = new Map();
    const incomeByDay = new Map(seriesKeys.map((key) => [key, 0]));
    for (const row of weekIncomeRows || []) {
        const day = String(row?._id?.day || "");
        const env = envKey(row?._id?.env);
        const profit = Number(row?.profit) || 0;
        if (day && incomeByDay.has(day)) incomeByDay.set(day, round2((incomeByDay.get(day) || 0) + profit));
        if (day === todayKey && env) {
            incomeTodayByEnv.set(env, round2((incomeTodayByEnv.get(env) || 0) + profit));
        }
    }
    const accountLosing = bots
        .map((bot) => {
            const key = envKey(ledgerEnv(bot));
            const userKey = envKey(bot.username);
            if (!incomeTodayByEnv.has(key) && !incomeTodayByEnv.has(userKey)) return null;
            const profit = round2(incomeTodayByEnv.has(key) ? incomeTodayByEnv.get(key) : incomeTodayByEnv.get(userKey));
            if (profit > limits.walletAttentionMin) return null;
            const why = signalLosing
                .filter((row) => row.username === bot.username && row.profit <= limits.signalAttentionMin)
                .slice(0, 3);
            const whyText = why.length
                ? ` Liên quan: ${why.map((row) => `${row.signal} ${moneyText(row.profit)}`).join(", ")}.`
                : " Xem income (phí/funding có thể khác lệnh đóng).";
            return withSeverity({
                type: "account",
                username: bot.username,
                title: `${bot.username} ví hôm nay ${moneyText(profit)}.${whyText}`,
                href: `/ledger?username=${encodeURIComponent(bot.username)}`,
                profit,
                env: ledgerEnv(bot),
                signals: why.map((row) => ({ env: row.env, signal: row.signal, count: row.count, profit: row.profit })),
            }, profit <= limits.walletCritical ? "critical" : "high");
        })
        .filter(Boolean);
    const signalItems = signalLosing
        .filter((row) => row.profit <= limits.signalAttentionMin)
        .map((row) => withSeverity({
            type: "loss",
            title: `${row.username}/${row.env} · ${row.signal} lỗ ${moneyText(row.profit)} (${row.count} lệnh) hôm nay`,
            href: `/config-lab/${encodeURIComponent(row.username)}/${encodeURIComponent(row.env)}`,
            username: row.username,
            env: row.env,
            signal: row.signal,
            count: row.count,
            profit: row.profit,
        }, "high"));
    const riskItems = (openRisk?.top || [])
        .filter((row) => row.unrealized != null && row.unrealized <= limits.upnlCritical)
        .slice(0, 3)
        .map((row) => withSeverity({
            type: "risk",
            title: `${row.username} · ${row.symbol} ${row.side} chưa chốt ${moneyText(row.unrealized)}`,
            href: row.href,
            username: row.username,
            symbol: row.symbol,
            side: row.side,
            profit: row.unrealized,
        }, "critical"));
    const staleHealthItems = health.bots
        .filter((row) => row.process === "stale" || row.process === "degraded")
        .slice(0, 3)
        .map((row) => withSeverity({
            type: "health",
            code: row.process,
            title: row.process === "degraded"
                ? `${row.username} trader MQTT đứt hoặc không ổn`
                : `${row.username} heartbeat trader/monitor quá hạn`,
            href: healthHref,
            username: row.username,
        }, "medium"));
    const skipAttention = canLogs ? buildSkipAttention(blocked || [], bots) : { actionable: [], filterItems: [], noiseCount: 0 };
    const exchangeItems = [];
    const exchangeSeen = new Set();
    for (const row of exchangeLogs || []) {
        if (!CREDENTIAL_RE.test(row.message || "") && !/insufficient|margin|balance|notional|-2019|-4164|-2027/i.test(row.message || "")) {
            continue;
        }
        const env = String(row.env || "").trim();
        const bot = ownerOf(bots, env) || bots.find((item) => envKey(item.username) === envKey(env));
        if (!bot) continue;
        const key = `${bot.username}|${envKey(env)}`;
        if (exchangeSeen.has(key)) continue;
        exchangeSeen.add(key);
        const reason = classifySkipReason(row.message);
        exchangeItems.push(withSeverity({
            type: "exchange",
            code: reason.code,
            username: bot.username,
            env: env || bot.username,
            title: `${bot.username}${env ? `/${env}` : ""} lỗi sàn: ${String(row.message || "").slice(0, 120)}`,
            href: "/logs?kind=runtime&category=exchange",
        }, "critical"));
        if (exchangeItems.length >= 3) break;
    }

    const profitByDay = new Map(seriesKeys.map((key) => [key, 0]));
    const profitByUser = new Map();
    let closedTrades = 0;
    let closedWins = 0;
    let closedLosses = 0;
    for (const row of weekProfitRows || []) {
        const day = String(row?._id?.day || "");
        const env = envKey(row?._id?.env);
        const profit = Number(row?.profit) || 0;
        if (day && profitByDay.has(day)) profitByDay.set(day, round2((profitByDay.get(day) || 0) + profit));
        if (day !== todayKey) continue;
        const bot = ownerOf(bots, env);
        if (!bot) continue;
        profitByUser.set(bot.username, (profitByUser.get(bot.username) || 0) + profit);
        closedTrades += Number(row.trades) || 0;
        closedWins += Number(row.wins) || 0;
        closedLosses += Number(row.losses) || 0;
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
            const item = withSeverity({
                type: "config",
                title: `${bot.username}/${doc.env} đang bật nhưng chưa có signal`,
                href: `/config-lab/${encodeURIComponent(bot.username)}/${encodeURIComponent(doc.env)}`,
                username: bot.username,
                env: doc.env,
            }, "low");
            configsOnWithoutSignal.push(item);
            attention.push(item);
        }
    }
    const keyed = new Set((apiRows || []).filter((row) => row.hasApiKey).map((row) => row.username));
    if (canKeys) {
        for (const bot of bots) {
            if (keyed.has(bot.username)) continue;
            if (missingApiKey.length >= 3) break;
            const item = withSeverity({
                type: "api",
                title: `${bot.username} chưa có API key`,
                href: `/user-apis/${encodeURIComponent(bot.username)}`,
                username: bot.username,
            }, "low");
            missingApiKey.push(item);
            attention.push(item);
        }
    }
    const removedItems = [];
    const removedSeen = new Set();
    for (const row of removed || []) {
        const env = String(row.env || "").trim();
        const signal = String(row.signal || "").trim().toUpperCase();
        const bot = ownerOf(bots, env);
        if (!bot || !env) continue;
        const key = `${bot.username}|${env}|${signal}`;
        if (removedSeen.has(key)) continue;
        removedSeen.add(key);
        removedItems.push(withSeverity({
            type: "removed",
            username: bot.username,
            env,
            signal,
            title: `${bot.username}/${env} bị gỡ signal ${signal || "?"} — xem thống kê Signal`,
            href: "/signal-search?tab=stats",
        }, "medium"));
        if (removedItems.length >= 3) break;
    }
    attention.push(...skipAttention.actionable, ...skipAttention.filterItems, ...removedItems);

    const processRank = { stale: 0, degraded: 1, unknown: 2, ok: 3, off: 4 };
    const mine = [...bots]
        .sort((a, b) => {
            const ha = healthByUser.get(a.username)?.process || "unknown";
            const hb = healthByUser.get(b.username)?.process || "unknown";
            const pr = (processRank[ha] ?? 9) - (processRank[hb] ?? 9);
            if (pr) return pr;
            const ua = openRisk?.byUser?.[a.username]?.unrealized || 0;
            const ub = openRisk?.byUser?.[b.username]?.unrealized || 0;
            if (ua !== ub) return ua - ub;
            return (profitByUser.get(b.username) || 0) - (profitByUser.get(a.username) || 0)
                || a.username.localeCompare(b.username);
        })
        .slice(0, MINE_LIMIT)
        .map((bot) => {
            const risk = openRisk?.byUser?.[bot.username];
            const hb = healthByUser.get(bot.username);
            return {
                username: bot.username,
                active: bot.active !== false,
                process: hb?.process || "unknown",
                configs: (bot.accounts || []).length,
                on: canConfig ? (onByUser.get(bot.username) || 0) : null,
                profitToday: canStats ? (profitByUser.get(bot.username) || 0) : null,
                unrealized: canPositions ? (risk ? risk.unrealized : null) : null,
                positions: canPositions ? (risk ? risk.positions : null) : null,
            };
        });

    const profitToday = canStats ? round2(profitByDay.get(todayKey) || 0) : null;
    const incomeToday = canStats ? round2(incomeByDay.get(todayKey) || 0) : null;
    const profitYesterday = canStats ? round2(profitByDay.get(yesterdayKey) || 0) : null;
    const incomeYesterday = canStats ? round2(incomeByDay.get(yesterdayKey) || 0) : null;
    const closedToday = canStats
        ? {
            trades: closedTrades,
            wins: closedWins,
            losses: closedLosses,
            winRate: closedTrades ? Math.round((closedWins / closedTrades) * 1000) / 10 : null,
        }
        : null;
    const compare = canStats
        ? {
            profitYesterday,
            incomeYesterday,
            profitDelta: round2((profitToday || 0) - (profitYesterday || 0)),
            incomeDelta: round2((incomeToday || 0) - (incomeYesterday || 0)),
        }
        : null;
    const series = canStats
        ? {
            days: seriesKeys,
            profit: seriesKeys.map((key) => profitByDay.get(key) || 0),
            income: seriesKeys.map((key) => incomeByDay.get(key) || 0),
        }
        : null;
    const activity = [];
    for (const row of recentCloses || []) {
        const env = String(row.env || "").trim();
        const bot = ownerOf(bots, env);
        if (!bot) continue;
        const signal = String(row.typeSignal || "").trim().toUpperCase();
        const symbol = String(row.symbol || "").toUpperCase();
        const profit = round2(row.profit);
        activity.push({
            kind: "close",
            at: row.closeTime ? new Date(row.closeTime).toISOString() : null,
            title: `${bot.username}/${env} đóng ${symbol || "?"} ${signal || ""} ${moneyText(profit)}`.replace(/\s+/g, " ").trim(),
            href: `/signals?user=${encodeURIComponent(bot.username)}`,
            profit,
        });
    }
    for (const row of exchangeItems) {
        activity.push({
            kind: "exchange",
            at: null,
            title: row.title,
            href: row.href,
        });
    }
    for (const row of removedItems.slice(0, 2)) {
        activity.push({
            kind: "removed",
            at: null,
            title: row.title,
            href: row.href,
        });
    }
    activity.splice(ACTIVITY_LIMIT);
    const listed = dedupeAttention(sortAttention([
        ...exchangeItems,
        ...accountLosing,
        ...riskItems,
        ...signalItems,
        ...staleHealthItems,
        ...attention,
    ])).slice(0, 12);
    const facts = {
        day: "UTC",
        profitToday,
        incomeToday,
        compare,
        closedToday,
        openRisk: openRisk
            ? {
                available: openRisk.available,
                positions: openRisk.positions,
                unrealized: openRisk.unrealized,
                staleBook: openRisk.staleBook,
                top: openRisk.top,
                href: "/positions",
            }
            : null,
        health: {
            ok: health.ok,
            stale: health.stale,
            off: health.off,
            unknown: health.unknown,
            staleBots: health.bots.filter((row) => row.process === "stale" || row.process === "degraded").map((row) => ({
                username: row.username,
                href: healthHref,
            })),
        },
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
        exchangeErrors: exchangeItems.map((row) => ({
            username: row.username,
            env: row.env,
            title: row.title,
            href: row.href,
        })),
        configsOnWithoutSignal: configsOnWithoutSignal.map((row) => ({ username: row.username, env: row.env, href: row.href })),
        missingApiKey: missingApiKey.map((row) => ({ username: row.username, href: row.href })),
        skippedFilters: skipAttention.filterItems.map((row) => ({
            username: row.username,
            env: row.env,
            code: row.code,
            title: row.title,
            href: row.href,
        })),
        skippedNoiseCount: skipAttention.noiseCount,
        blocked: skipAttention.actionable.map((row) => ({
            env: row.env || "",
            signal: row.signal || "",
            title: row.title,
            href: row.href,
        })),
        removed: removedItems.map((row) => ({
            env: row.env || "",
            signal: row.signal || "",
            title: row.title,
            href: row.href,
        })),
    };
    return {
        asOf: now.toISOString(),
        day: "UTC",
        bots: { active: bots.filter((bot) => bot.active !== false).length, total: bots.length },
        configs: canConfig ? { on: onCount, total: envs.length } : null,
        profitToday,
        incomeToday,
        closedToday,
        compare,
        series,
        activity,
        openRisk: openRisk
            ? {
                available: openRisk.available,
                positions: openRisk.positions,
                unrealized: openRisk.available ? openRisk.unrealized : null,
                notional: openRisk.available ? openRisk.notional : null,
                staleBook: openRisk.staleBook,
                top: openRisk.top,
            }
            : null,
        health,
        attention: listed.map(({ type, severity, title, href }) => ({ type, severity, title, href })),
        mine,
        thresholds: limits,
        ai: attentionPackage(facts),
    };
}

async function getDashboard(actor, now = new Date(), deps = {}) {
    const ttl = cacheTtlMs(deps);
    const refresh = deps.refresh === true;
    const key = cacheKey(actor);
    const at = now instanceof Date ? now.getTime() : Date.now();
    if (!refresh && ttl > 0 && actor?.id) {
        const hit = dashboardCache.get(key);
        if (hit && at - hit.at < ttl) {
            return {
                ...hit.payload,
                cached: true,
                cacheAgeMs: at - hit.at,
                staleAt: new Date(hit.at + ttl).toISOString(),
            };
        }
    }
    const payload = await computeDashboard(actor, now, deps);
    const out = {
        ...payload,
        cached: false,
        cacheAgeMs: 0,
        staleAt: new Date(at + ttl).toISOString(),
    };
    if (ttl > 0 && actor?.id) {
        dashboardCache.set(key, { at, payload });
        if (dashboardCache.size > 200) {
            const oldest = dashboardCache.keys().next().value;
            dashboardCache.delete(oldest);
        }
    }
    return out;
}

module.exports = {
    getDashboard,
    computeDashboard,
    buildHealth,
    buildOpenRisk,
    classifySkipReason,
    buildSkipAttention,
    clearDashboardCache,
    severityThresholds,
    HEARTBEAT_MS,
    WALLET_CRITICAL,
    WALLET_ATTENTION_MIN,
    UPNL_CRITICAL,
    DEFAULT_CACHE_MS,
};
