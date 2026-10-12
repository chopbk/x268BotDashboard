const AccountStatic = require("../models/account-static");
const AccountConfig = require("../models/account-config");
const { PERMISSIONS } = require("../auth/access-control");
const { requireBot } = require("./bot-directory");
const { httpError } = require("./http");
const { openTimeFilter, openTimeRange } = require("./open-time-range");
const { findSymbolInfo } = require("./symbol-info");

const DETAIL_FIELDS = "env typeSignal symbol side entryPrice closePrice futuresLeverage costAmount positionAmt volume openTime closeTime status roe profit tps isCopy isLimit isPaper isClosed closeReason logs stats createdAt updatedAt";
const DAY_MS = 24 * 60 * 60 * 1000;
const STREAK_CAP = 10000;
const LOW_SAMPLE = 20;

function escapeRegex(value) { return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function finite(value) {
    if (value == null || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function signalMatcher(value) {
    const name = String(value || "").trim();
    if (!name) return null;
    return new RegExp(`^${escapeRegex(name)}$`, "i");
}

function profitFilter(value) {
    const side = String(value || "").trim().toLowerCase();
    if (side === "win") return { $gt: 0 };
    if (side === "loss") return { $lt: 0 };
    if (side === "flat") return 0;
    return null;
}

function round3(value) {
    return Math.round(Number(value) * 1000) / 1000;
}

function utcDayStart(date = new Date()) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function parseUtcDay(value, end) {
    const text = String(value || "").trim();
    if (!text) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) throw httpError(400, "Ngày không hợp lệ");
    return new Date(Date.UTC(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        end ? 23 : 0,
        end ? 59 : 0,
        end ? 59 : 0,
        end ? 999 : 0
    ));
}

function analyticsRange(input = {}, now = new Date()) {
    const preset = String(input.range || "").trim().toLowerCase();
    if (preset === "today") {
        return { preset: "today", from: utcDayStart(now), to: now };
    }
    if (["7", "7d", "30", "30d", "90", "90d"].includes(preset)) {
        const days = Number(String(preset).replace("d", ""));
        return { preset: String(days), from: new Date(now.getTime() - days * DAY_MS), to: now };
    }
    if (preset === "custom" || input.from || input.to) {
        const fromIso = input.from && !/^\d{4}-\d{2}-\d{2}$/.test(String(input.from).trim())
            ? openTimeRange(input, now)
            : null;
        if (fromIso) return { preset: "custom", from: fromIso.from, to: fromIso.to || now };
        const from = parseUtcDay(input.from, false) || openTimeRange(input, now).from;
        const to = parseUtcDay(input.to, true) || (input.to ? openTimeRange(input, now).to : now);
        if (from && to && from > to) throw httpError(400, "Ngày bắt đầu phải trước ngày kết thúc");
        return { preset: "custom", from, to: to || now };
    }
    return { preset: "7", from: new Date(now.getTime() - 7 * DAY_MS), to: now };
}

function resolveTimeField(input) {
    const value = String(input.time || input.timeField || "").trim().toLowerCase();
    if (value === "open" || value === "opentime") return "openTime";
    if (value === "close" || value === "closetime") return "closeTime";
    // analytics UI gửi time=close; API cũ không gửi → giữ openTime để không đổi deep-link cũ
    if (input.range || input.analytics === "1" || input.analytics === "true") return "closeTime";
    return "openTime";
}

function toStatic(row) {
    const profit = finite(row.profit);
    const roe = finite(row.roe);
    const cost = finite(row.costAmount);
    return {
        id: String(row._id),
        env: row.env,
        signal: row.typeSignal,
        symbol: row.symbol,
        side: row.side,
        entryPrice: row.entryPrice,
        closePrice: row.closePrice,
        leverage: row.futuresLeverage,
        cost: row.costAmount,
        positionAmt: row.positionAmt,
        volume: row.volume,
        openTime: row.openTime,
        closeTime: row.closeTime,
        status: row.status,
        roe,
        profit,
        pnlOverCost: cost && profit != null ? round3((profit / cost) * 100) : null,
        tps: Array.isArray(row.tps) ? row.tps : [],
        copy: !!row.isCopy,
        limit: !!row.isLimit,
        paper: !!row.isPaper,
        closed: !!row.isClosed,
        closeReason: row.closeReason || "",
        holdMs: (() => {
            const open = new Date(row.openTime).getTime();
            const close = new Date(row.closeTime).getTime();
            if (!Number.isFinite(open) || !Number.isFinite(close)) return null;
            return Math.max(0, close - open);
        })(),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
    };
}

const volumeExpr = {
    $ifNull: ["$volume", { $multiply: [{ $ifNull: ["$costAmount", 0] }, { $abs: { $ifNull: ["$futuresLeverage", 1] } }] }],
};

/** Chỉ cộng profit khi là số BSON; không ép null/string → 0 */
const profitTypeOk = { $in: [{ $type: "$profit" }, ["double", "int", "long", "decimal"]] };
const profitValue = "$profit";
const winCond = { $and: [profitTypeOk, { $gt: [profitValue, 0] }] };
const lossCond = { $and: [profitTypeOk, { $lt: [profitValue, 0] }] };
const flatCond = { $and: [profitTypeOk, { $eq: [profitValue, 0] }] };

function groupMetrics(idExpr) {
    return {
        _id: idExpr,
        count: { $sum: 1 },
        valid: { $sum: { $cond: [profitTypeOk, 1, 0] } },
        missingProfit: { $sum: { $cond: [profitTypeOk, 0, 1] } },
        profit: { $sum: { $cond: [profitTypeOk, profitValue, 0] } },
        grossWin: { $sum: { $cond: [winCond, profitValue, 0] } },
        grossLoss: { $sum: { $cond: [lossCond, profitValue, 0] } },
        cost: { $sum: { $cond: [{ $in: [{ $type: "$costAmount" }, ["double", "int", "long", "decimal"]] }, "$costAmount", 0] } },
        volume: { $sum: volumeExpr },
        maxVolume: { $max: volumeExpr },
        minVolume: { $min: volumeExpr },
        wins: { $sum: { $cond: [winCond, 1, 0] } },
        losses: { $sum: { $cond: [lossCond, 1, 0] } },
        flats: { $sum: { $cond: [flatCond, 1, 0] } },
        maxProfit: { $max: { $cond: [profitTypeOk, profitValue, null] } },
        minProfit: { $min: { $cond: [profitTypeOk, profitValue, null] } },
        longCount: { $sum: { $cond: [{ $eq: ["$side", "LONG"] }, 1, 0] } },
        shortCount: { $sum: { $cond: [{ $eq: ["$side", "SHORT"] }, 1, 0] } },
        longProfit: {
            $sum: {
                $cond: [
                    { $and: [{ $eq: ["$side", "LONG"] }, profitTypeOk] },
                    profitValue,
                    0,
                ],
            },
        },
        shortProfit: {
            $sum: {
                $cond: [
                    { $and: [{ $eq: ["$side", "SHORT"] }, profitTypeOk] },
                    profitValue,
                    0,
                ],
            },
        },
        holdSum: {
            $sum: {
                $cond: [
                    {
                        $and: [
                            { $in: [{ $type: "$openTime" }, ["date"]] },
                            { $in: [{ $type: "$closeTime" }, ["date"]] },
                        ],
                    },
                    { $max: [0, { $subtract: ["$closeTime", "$openTime"] }] },
                    0,
                ],
            },
        },
        holdCount: {
            $sum: {
                $cond: [
                    {
                        $and: [
                            { $in: [{ $type: "$openTime" }, ["date"]] },
                            { $in: [{ $type: "$closeTime" }, ["date"]] },
                        ],
                    },
                    1,
                    0,
                ],
            },
        },
    };
}

/** Bot thường ghi closeTime nhưng không set isClosed=true — coi có closeTime là đã đóng. */
function closedClause(closed) {
    const value = String(closed || "").trim().toLowerCase();
    if (value === "closed") {
        return {
            $or: [
                { isClosed: true },
                { closeTime: { $exists: true, $ne: null } },
            ],
        };
    }
    if (value === "open") {
        return {
            isClosed: { $ne: true },
            $and: [
                { $or: [{ closeTime: null }, { closeTime: { $exists: false } }] },
            ],
        };
    }
    return null;
}

function presentGroup(row, nameKey, username) {
    const count = row?.count || 0;
    const valid = row?.valid || 0;
    const wins = row?.wins || 0;
    const losses = row?.losses || 0;
    const flats = row?.flats || 0;
    const cost = row?.cost || 0;
    const volume = row?.volume || 0;
    const profit = valid ? round3(row?.profit || 0) : null;
    const grossWin = row?.grossWin || 0;
    const grossLoss = row?.grossLoss || 0;
    const rated = wins + losses + flats;
    let profitFactor = null;
    let profitFactorLabel = null;
    if (wins > 0 && losses > 0) profitFactor = round3(grossWin / Math.abs(grossLoss));
    else if (wins > 0 && losses === 0) profitFactorLabel = "Không có lệnh lỗ";
    else if (valid === 0) profitFactorLabel = null;
    return {
        [nameKey]: row?._id || "UNKNOWN",
        username: username || undefined,
        count,
        valid,
        missingProfit: row?.missingProfit || 0,
        wins,
        losses,
        flats,
        winRate: rated ? round3((wins / rated) * 100) : null,
        profit,
        cost,
        avgRoi: cost && profit != null ? round3((profit / cost) * 100) : null,
        pnlOverCost: cost && profit != null ? round3((profit / cost) * 100) : null,
        volume,
        avgVolume: count ? round3(volume / count) : null,
        maxVolume: row?.maxVolume ?? null,
        minVolume: row?.minVolume ?? null,
        maxProfit: row?.maxProfit == null ? null : round3(row.maxProfit),
        minProfit: row?.minProfit == null ? null : round3(row.minProfit),
        avgWin: wins ? round3(grossWin / wins) : null,
        avgLoss: losses ? round3(grossLoss / losses) : null,
        profitFactor,
        profitFactorLabel,
        avgHoldMs: row?.holdCount ? Math.round((row.holdSum || 0) / row.holdCount) : null,
        longCount: row?.longCount || 0,
        shortCount: row?.shortCount || 0,
        longProfit: round3(row?.longProfit || 0),
        shortProfit: round3(row?.shortProfit || 0),
        lowSample: count < LOW_SAMPLE,
        // tương thích UI cũ
        roi: null,
        avgWinRoe: null,
        avgLossRoe: null,
    };
}

function byProfit(rows) {
    return [...rows].sort((a, b) => (Number(b.profit) || 0) - (Number(a.profit) || 0) || (b.count || 0) - (a.count || 0));
}

function presentConfigSignal(row, username) {
    const id = row?._id && typeof row._id === "object" ? row._id : {};
    return {
        env: id.env || "UNKNOWN",
        ...presentGroup({ ...row, _id: id.signal || "UNKNOWN" }, "signal", username),
    };
}

function byConfigThenProfit(rows) {
    return [...rows].sort((a, b) => String(a.env).localeCompare(String(b.env)) || (Number(b.profit) || 0) - (Number(a.profit) || 0) || (b.count || 0) - (a.count || 0));
}

function signalMatch(input) {
    const signalNames = String(input.signal || "").split(",").map((item) => item.trim()).filter(Boolean);
    const mode = String(input.signalMode || "").trim().toLowerCase();
    if (signalNames.length === 1) {
        const name = signalNames[0];
        if (mode === "contains") return { typeSignal: new RegExp(escapeRegex(name), "i") };
        const matcher = signalMatcher(name);
        return matcher ? { typeSignal: matcher } : {};
    }
    if (signalNames.length > 1) {
        const clauses = signalNames.map((name) => signalMatcher(name)).filter(Boolean).map((matcher) => ({ typeSignal: matcher }));
        return clauses.length ? { $or: clauses } : {};
    }
    return {};
}

async function resolveBook(input, envs) {
    const requested = String(input.book || "").trim().toLowerCase();
    if (requested === "live" || requested === "paper" || requested === "all") return requested;
    if (input.range || input.analytics === "1" || input.analytics === "true") return "live";
    if (!envs.length) return "live";
    let rows = [];
    try {
        rows = await AccountConfig.find({ env: { $in: envs } }).select("env trade_config.PAPER").lean();
    } catch (error) {
        console.error("[listAccountStatics]", error?.code || error?.name || "paper-config");
        return "live";
    }
    const paper = new Set((rows || []).filter((row) => row?.trade_config?.PAPER === true).map((row) => row.env));
    return envs.every((env) => paper.has(env)) ? "paper" : "live";
}

function buildTimeClause(timeField, range) {
    const bound = openTimeFilter(range);
    if (!bound) return {};
    if (timeField === "closeTime") {
        return {
            closeTime: {
                $exists: true,
                $ne: null,
                ...bound,
            },
        };
    }
    return { openTime: bound };
}

function staticScope(input, envs, range, timeField) {
    const base = { env: { $in: envs }, ...buildTimeClause(timeField, range) };
    const book = String(input.book || "live").trim().toLowerCase();
    if (book === "paper") base.isPaper = true;
    else if (book !== "all") base.isPaper = { $ne: true };
    const copy = String(input.copy || "").trim().toLowerCase();
    if (copy === "copy") base.isCopy = true;
    else if (copy === "manual") base.isCopy = { $ne: true };
    if (["LONG", "SHORT"].includes(input.side)) base.side = input.side;
    const q = String(input.q || input.symbol || "").trim();
    if (q) base.symbol = new RegExp(escapeRegex(q), "i");
    const clauses = [base];
    const closed = closedClause(input.closed);
    if (closed) clauses.push(closed);
    const signal = signalMatch(input);
    if (Object.keys(signal).length) clauses.push(signal);
    const extras = {};
    const status = String(input.status || "").trim().toUpperCase();
    if (/^[A-Z0-9_]{1,16}$/.test(status)) extras.status = status;
    const profit = profitFilter(input.profit);
    if (profit !== null) extras.profit = profit;
    if (Object.keys(extras).length) clauses.push(extras);
    const filter = clauses.length === 1 ? clauses[0] : { $and: clauses };
    return { scope: filter, filter };
}

function listDayFilter(input) {
    const day = String(input.listDay || input.day || "").trim();
    if (!day) return null;
    const from = parseUtcDay(day, false);
    const to = parseUtcDay(day, true);
    if (!from || !to) return null;
    return { closeTime: { $gte: from, $lte: to } };
}

function fillSeries(from, to, byDay) {
    const start = utcDayStart(from || new Date());
    const end = utcDayStart(to || new Date());
    const map = new Map((byDay || []).map((row) => [row.day, row]));
    const series = [];
    let cumulative = 0;
    for (let cursor = start.getTime(); cursor <= end.getTime(); cursor += DAY_MS) {
        const key = new Date(cursor).toISOString().slice(0, 10);
        const row = map.get(key);
        const dayPnl = row?.profit != null ? round3(row.profit) : 0;
        const trades = row?.count || 0;
        cumulative = round3(cumulative + dayPnl);
        series.push({ day: key, trades, profit: dayPnl, cumulative });
    }
    return series;
}

function longestLosingStreak(rows) {
    let best = 0;
    let current = 0;
    for (const row of rows || []) {
        const profit = finite(row.profit);
        if (profit == null) continue;
        if (profit < 0) {
            current += 1;
            if (current > best) best = current;
        } else current = 0;
    }
    return best;
}

function buildInsights({ stats, bySignal, byConfig, bySide, rangeLabel, username }) {
    const notes = [];
    const push = (note) => {
        if (notes.length >= 3) return;
        if (notes.some((item) => item.code === note.code)) return;
        notes.push(note);
    };

    if (!stats || !stats.valid) {
        if (stats?.excludedMissingClose > 0) {
            push({
                code: "missing-close",
                kind: "data",
                title: "Thiếu thời gian đóng",
                text: `${stats.excludedMissingClose} bản ghi bị loại vì thiếu closeTime khi lọc theo ngày đóng (${rangeLabel}). Đây là mô tả dữ liệu, không phải kết luận về hiệu suất.`,
            });
        }
        return notes;
    }

    if (stats.profit != null && stats.profit > 0 && stats.maxProfit != null && stats.maxProfit > 0) {
        const without = round3(stats.profit - stats.maxProfit);
        if (without < 0) {
            push({
                code: "one-win-dependency",
                kind: "data",
                title: "Phụ thuộc một lệnh thắng lớn",
                text: `Tổng PnL +${stats.profit}$. Nếu bỏ lệnh thắng lớn nhất (+${stats.maxProfit}$) thì còn ${without}$ trên cùng bộ lọc ${rangeLabel}.`,
            });
        }
    }

    if (stats.wins >= 5 && stats.losses >= 3 && stats.avgWin != null && stats.avgLoss != null) {
        if (stats.winRate != null && stats.winRate >= 55 && Math.abs(stats.avgLoss) > Math.abs(stats.avgWin)) {
            push({
                code: "asymmetric-loss",
                kind: "data",
                title: "Win rate cao nhưng lỗ trung bình lớn hơn",
                text: `Win rate ${stats.winRate}% trên ${stats.valid} lệnh, nhưng lỗ TB ${stats.avgLoss}$ lớn hơn lãi TB +${stats.avgWin}$ (mẫu số = lệnh có profit hợp lệ trong ${rangeLabel}).`,
            });
        }
    }

    const long = (bySide || []).find((row) => row.side === "LONG");
    const short = (bySide || []).find((row) => row.side === "SHORT");
    if (long && short && long.profit != null && short.profit != null) {
        if (long.profit > 0 && short.profit < 0) {
            push({
                code: "long-vs-short",
                kind: "data",
                title: "Long lãi, Short lỗ",
                text: `Long +${long.profit}$ (${long.valid} lệnh) trong khi Short ${short.profit}$ (${short.valid} lệnh) ở ${rangeLabel}.`,
                action: { type: "side", value: "LONG" },
            });
        } else if (short.profit > 0 && long.profit < 0) {
            push({
                code: "long-vs-short",
                kind: "data",
                title: "Short lãi, Long lỗ",
                text: `Short +${short.profit}$ (${short.valid} lệnh) trong khi Long ${long.profit}$ (${long.valid} lệnh) ở ${rangeLabel}.`,
                action: { type: "side", value: "SHORT" },
            });
        }
    }

    const topSignal = byProfit(bySignal || []).find((row) => row.profit != null);
    if (topSignal && Math.abs(Number(topSignal.profit)) > 0) {
        const tone = Number(topSignal.profit) > 0 ? "lãi" : "lỗ";
        push({
            code: "top-signal",
            kind: "data",
            title: `Signal ${tone} lớn nhất`,
            text: `Trong ${rangeLabel}, signal ${topSignal.signal} có tổng PnL ${Number(topSignal.profit) > 0 ? "+" : ""}${topSignal.profit}$ trên ${topSignal.valid} lệnh có profit hợp lệ${username ? ` của ${username}` : ""}.`,
            action: { type: "signal", value: topSignal.signal },
        });
    }

    const topConfig = byProfit(byConfig || []).find((row) => row.profit != null);
    if (topConfig && Math.abs(Number(topConfig.profit)) > 0) {
        const tone = Number(topConfig.profit) > 0 ? "lãi" : "lỗ";
        const sameDirectionAsSignal = topSignal && Math.sign(Number(topSignal.profit)) === Math.sign(Number(topConfig.profit));
        if (!sameDirectionAsSignal || Math.abs(Number(topConfig.profit)) >= Math.abs(Number(topSignal?.profit || 0))) {
            push({
                code: "top-config",
                kind: "data",
                title: `Config ${tone} lớn nhất`,
                text: `Config ${username ? `${username} / ` : ""}${topConfig.env} ghi nhận PnL ${Number(topConfig.profit) > 0 ? "+" : ""}${topConfig.profit}$ trên ${topConfig.valid} lệnh (${rangeLabel}).`,
                action: { type: "env", value: topConfig.env },
            });
        }
    }

    if (stats.valid < LOW_SAMPLE) {
        push({
            code: "low-sample",
            kind: "data",
            title: "Ít mẫu",
            text: `Chỉ có ${stats.valid} lệnh có profit hợp lệ trong ${rangeLabel}. Nhãn “Ít dữ liệu” chỉ hỗ trợ đọc số liệu, không bảo đảm độ tin cậy thống kê.`,
        });
    } else if (stats.missingProfit > 0 || stats.excludedMissingClose > 0) {
        push({
            code: "missing-data",
            kind: "data",
            title: "Thiếu dữ liệu một phần",
            text: [
                stats.missingProfit > 0 ? `${stats.missingProfit} lệnh thiếu profit hợp lệ` : null,
                stats.excludedMissingClose > 0 ? `${stats.excludedMissingClose} bản ghi thiếu closeTime bị loại` : null,
            ].filter(Boolean).join("; ") + ` (${rangeLabel}).`,
        });
    }

    return notes.slice(0, 3).map((note) => ({
        ...note,
        code: String(note.code || "").replace(/\s+/g, ""),
    }));
}

function formatRangeLabel(range, timeField) {
    const from = range?.from ? new Date(range.from).toISOString().slice(0, 10) : "?";
    const to = range?.to ? new Date(range.to).toISOString().slice(0, 10) : "nay";
    const axis = timeField === "closeTime" ? "ngày đóng" : "ngày mở";
    return `${from} → ${to} UTC · theo ${axis}`;
}

async function listAccountStatics(actor, input = {}) {
    const username = String(input.username || "").trim();
    const env = String(input.env || "").trim();
    if (!username) throw httpError(400, "Thiếu user bot");
    const bot = await requireBot(actor, username, PERMISSIONS.STATISTICS_VIEW);
    const envs = env ? [env] : (bot.accounts || []);
    if (env && !(bot.accounts || []).includes(env)) throw httpError(404, "Config không thuộc user bot này");
    const page = Math.max(1, Number.parseInt(input.page, 10) || 1);
    const limit = Math.min(100, Math.max(10, Number.parseInt(input.limit, 10) || 50));
    const timeField = resolveTimeField(input);
    const useAnalyticsDefaults = Boolean(input.range || input.analytics === "1" || input.analytics === "true" || timeField === "closeTime");
    const range = useAnalyticsDefaults && (input.range || !input.from)
        ? analyticsRange(input)
        : openTimeRange(input);
    const book = await resolveBook(input, envs);
    const closedDefault = useAnalyticsDefaults && !String(input.closed || "").trim() ? "closed" : input.closed;
    const { filter } = staticScope({ ...input, book, closed: closedDefault }, envs, range, timeField);

    let excludedMissingClose = 0;
    if (timeField === "closeTime" && (range.from || range.to)) {
        const missingFilter = {
            env: { $in: envs },
            ...(book === "paper" ? { isPaper: true } : book === "all" ? {} : { isPaper: { $ne: true } }),
            $or: [{ closeTime: null }, { closeTime: { $exists: false } }],
        };
        try {
            excludedMissingClose = await AccountStatic.countDocuments(missingFilter);
        } catch (error) {
            console.error("[listAccountStatics]", error?.code || error?.name || "missing-close-count");
        }
    }

    const dayOnly = listDayFilter(input);
    const listFilter = dayOnly ? { $and: [filter, dayOnly] } : filter;
    const sort = timeField === "closeTime"
        ? { closeTime: -1, _id: -1 }
        : { openTime: -1, _id: -1 };

    const [rows, total, totals, breakdown, dayRows, streakRows] = await Promise.all([
        AccountStatic.find(listFilter).select(DETAIL_FIELDS).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
        AccountStatic.countDocuments(listFilter),
        AccountStatic.aggregate([
            { $match: filter },
            { $group: groupMetrics(null) },
        ]),
        AccountStatic.aggregate([
            { $match: filter },
            {
                $facet: {
                    bySignal: [{ $group: groupMetrics("$typeSignal") }],
                    byConfigSignal: [{ $group: groupMetrics({ env: "$env", signal: "$typeSignal" }) }],
                    byEnv: [{ $group: groupMetrics("$env") }],
                    byConfig: [{ $group: groupMetrics("$env") }],
                    bySymbol: [{ $group: groupMetrics("$symbol") }],
                    bySide: [{ $group: groupMetrics("$side") }],
                    byStatus: [{ $group: { _id: "$status", count: { $sum: 1 }, profit: { $sum: { $cond: [profitTypeOk, "$profit", 0] } } } }],
                },
            },
        ]),
        AccountStatic.aggregate([
            { $match: filter },
            { $match: { closeTime: { $exists: true, $ne: null, $type: "date" } } },
            {
                $group: {
                    _id: { $dateToString: { format: "%Y-%m-%d", date: "$closeTime", timezone: "UTC" } },
                    count: { $sum: 1 },
                    profit: { $sum: { $cond: [profitTypeOk, "$profit", 0] } },
                },
            },
            { $sort: { _id: 1 } },
        ]),
        AccountStatic.find(filter).select("profit closeTime").sort({ closeTime: 1, _id: 1 }).limit(STREAK_CAP).lean(),
    ]);

    const sum = totals[0] || {};
    const valid = sum.valid || 0;
    const wins = sum.wins || 0;
    const losses = sum.losses || 0;
    const flats = sum.flats || 0;
    const rated = wins + losses + flats;
    const profit = valid ? round3(sum.profit || 0) : null;
    const grossWin = sum.grossWin || 0;
    const grossLoss = sum.grossLoss || 0;
    let profitFactor = null;
    let profitFactorLabel = null;
    if (wins > 0 && losses > 0) profitFactor = round3(grossWin / Math.abs(grossLoss));
    else if (wins > 0 && losses === 0 && valid > 0) profitFactorLabel = "Không có lệnh lỗ";

    const facet = breakdown[0] || {};
    const bySignal = byProfit((facet.bySignal || []).map((row) => presentGroup(row, "signal", username)));
    const byConfig = byProfit((facet.byConfig || []).map((row) => presentGroup(row, "env", username)));
    const bySymbol = byProfit((facet.bySymbol || []).map((row) => presentGroup(row, "symbol", username)));
    const bySide = (facet.bySide || []).map((row) => presentGroup(row, "side", username));
    const byEnv = byProfit((facet.byEnv || []).map((row) => presentGroup(row, "env", username)));
    const byConfigSignal = byConfigThenProfit((facet.byConfigSignal || []).map((row) => presentConfigSignal(row, username)));

    const stats = {
        total: sum.count || 0,
        valid,
        missingProfit: sum.missingProfit || 0,
        excludedMissingClose,
        wins,
        losses,
        flats,
        winRate: rated ? round3((wins / rated) * 100) : null,
        profit,
        avgProfit: valid ? round3((sum.profit || 0) / valid) : null,
        cost: round3(sum.cost || 0),
        avgRoi: sum.cost && profit != null ? round3((profit / sum.cost) * 100) : null,
        pnlOverCost: sum.cost && profit != null ? round3((profit / sum.cost) * 100) : null,
        volume: round3(sum.volume || 0),
        longProfit: round3(sum.longProfit || 0),
        shortProfit: round3(sum.shortProfit || 0),
        maxProfit: sum.maxProfit == null ? null : round3(sum.maxProfit),
        minProfit: sum.minProfit == null ? null : round3(sum.minProfit),
        avgWin: wins ? round3(grossWin / wins) : null,
        avgLoss: losses ? round3(grossLoss / losses) : null,
        profitFactor,
        profitFactorLabel,
        avgHoldMs: sum.holdCount ? Math.round((sum.holdSum || 0) / sum.holdCount) : null,
        longestLosingStreak: longestLosingStreak(streakRows),
        streakTruncated: (streakRows || []).length >= STREAK_CAP,
        lowSample: (sum.count || 0) < LOW_SAMPLE,
        bySignal,
        byConfigSignal,
        byEnv,
        byConfig,
        bySymbol,
        bySide,
        byStatus: (facet.byStatus || []).map((row) => ({ status: row._id || "UNKNOWN", count: row.count, profit: round3(row.profit || 0) })),
        // tương thích cũ
        roi: null,
    };

    const series = fillSeries(
        range.from,
        range.to || new Date(),
        (dayRows || []).map((row) => ({ day: row._id, count: row.count, profit: round3(row.profit || 0) }))
    );

    const rangeLabel = formatRangeLabel(range, timeField);
    const insights = buildInsights({ stats, bySignal, byConfig, bySide, rangeLabel, username });

    return {
        rows: rows.map(toStatic),
        stats,
        series,
        insights,
        formulas: {
            pnl: "Tổng field profit trên account_statics sau bộ lọc. Không gọi là lãi ròng sau phí trừ khi bản ghi có cờ phí đầy đủ.",
            winRate: "Số lệnh profit > 0 / số lệnh có profit hợp lệ (thắng + thua + hòa). Không dùng status WIN/LOSS làm nguồn duy nhất.",
            profitFactor: "Tổng profit dương / abs(tổng profit âm). Không có lệnh lỗ → nhãn “Không có lệnh lỗ”.",
            avgProfit: "Tổng profit / số lệnh có profit hợp lệ.",
            pnlOverCost: "Tổng profit / tổng costAmount lệnh. Cost không phải vốn tài khoản vì cùng nguồn vốn có thể tái sử dụng.",
            roe: "Field roe bot đã lưu: live thường là % biến động giá so với entry (không nhân đòn bẩy); paper thường là profit/cost. Không hiển thị như ROI tài khoản.",
            series: "Trục ngày theo closeTime UTC của tập lệnh đang xem. Nếu lọc theo openTime, đây vẫn là ngày đóng của nhóm lệnh mở trong kỳ.",
            hold: "Trung bình closeTime − openTime trên bản ghi có đủ hai mốc.",
            streak: "Chuỗi thua dài nhất theo thứ tự closeTime trong bộ lọc hiện tại.",
        },
        page,
        limit,
        total,
        listTotal: total,
        username,
        env: env || null,
        envs,
        book,
        timeField,
        rangePreset: range.preset || null,
        from: range.from,
        to: range.to,
        listDay: dayOnly ? String(input.listDay || input.day || "") : null,
        rangeLabel,
        generatedAt: new Date().toISOString(),
    };
}

async function getAccountStatic(actor, id, input = {}) {
    const username = String(input.username || "").trim();
    if (!username) throw httpError(400, "Thiếu user bot");
    if (!/^[a-f0-9]{24}$/i.test(String(id || ""))) throw httpError(400, "Mã giao dịch không hợp lệ");
    const bot = await requireBot(actor, username, PERMISSIONS.STATISTICS_VIEW);
    const row = await AccountStatic.findOne({ _id: id, env: { $in: bot.accounts || [] } }).select(DETAIL_FIELDS).lean();
    if (!row) throw httpError(404, "Không tìm thấy giao dịch");
    const trade = toStatic(row);
    trade.logs = Array.isArray(row.logs) ? row.logs.slice(-80) : [];
    trade.stats = row.stats && typeof row.stats === "object" ? row.stats : {};
    trade.roeBasis = row.isPaper
        ? "profit/cost của paper (không phải ROI tài khoản)"
        : "biến động giá so với entry, không nhân đòn bẩy (không phải ROI tài khoản)";
    trade.pnlNote = trade.stats?.pnlIncludesFees === true
        ? "profit đã gồm realized, commission và funding theo income symbol từ lúc mở (theo cờ bot)."
        : "profit là số bot đã lưu trên account_statics; chưa xác minh đủ phí/funding trên mọi bản ghi.";
    try {
        trade.symbolInfo = await findSymbolInfo(row.symbol);
    } catch (error) {
        console.error("[getAccountStatic]", error?.code || error?.name || "symbolInfo");
        trade.symbolInfo = null;
    }
    return trade;
}

async function listAssignedStatics(actor, input = {}) {
    const { usersForAudience } = require("./account-ledger");
    const scope = input.scope === "all" ? "all" : "mine";
    const users = await usersForAudience(actor, scope);
    const envUser = new Map();
    for (const user of users) {
        for (const env of user.accounts || []) {
            const name = String(env || "").trim();
            if (name && !envUser.has(name)) envUser.set(name, user.username);
        }
    }
    const envs = [...envUser.keys()];
    const range = openTimeRange(input);
    const empty = {
        scope,
        usernames: users.map((user) => user.username),
        stats: { total: 0, profit: null, winRate: null, byConfigSignal: [] },
        book: "live",
        from: range.from,
        to: range.to,
    };
    if (!envs.length) return empty;
    const filter = { env: { $in: envs }, openTime: openTimeFilter(range), isPaper: { $ne: true } };
    const [total, totals, grouped] = await Promise.all([
        AccountStatic.countDocuments(filter),
        AccountStatic.aggregate([{ $match: filter }, { $group: groupMetrics(null) }]),
        AccountStatic.aggregate([{ $match: filter }, { $group: groupMetrics({ env: "$env", signal: "$typeSignal" }) }]),
    ]);
    const sum = totals[0] || {};
    const valid = sum.valid || 0;
    const rated = (sum.wins || 0) + (sum.losses || 0) + (sum.flats || 0);
    return {
        ...empty,
        stats: {
            total,
            valid,
            profit: valid ? round3(sum.profit || 0) : null,
            winRate: rated ? round3(((sum.wins || 0) / rated) * 100) : null,
            byConfigSignal: (grouped || []).map((row) => ({
                username: envUser.get(row?._id?.env) || "UNKNOWN",
                ...presentConfigSignal(row, envUser.get(row?._id?.env)),
            })).sort((a, b) => String(a.username).localeCompare(String(b.username)) || String(a.env).localeCompare(String(b.env)) || (Number(b.profit) || 0) - (Number(a.profit) || 0)),
        },
    };
}

module.exports = {
    listAccountStatics,
    listAssignedStatics,
    getAccountStatic,
    analyticsRange,
    resolveTimeField,
    presentGroup,
    longestLosingStreak,
    buildInsights,
    fillSeries,
};
