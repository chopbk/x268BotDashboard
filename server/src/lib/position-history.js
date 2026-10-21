const AccountStatic = require("../models/account-static");
const MonitorPosition = require("../models/monitor-position");
const { PERMISSIONS, canAccessResource, hasPermission } = require("../auth/access-control");
const { httpError } = require("./http");
const { usersForAudience } = require("./account-ledger");

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE_LIMIT = 30;
const SNAPSHOT_KEYS = [
    "openType", "tpType", "slType", "trailingOn", "trailingType", "hold", "tpCount", "tpPrices",
    "slPriceOpen", "leverage", "costAmount", "entryPrice", "isCopy", "isLimit", "isPaper", "signal",
    "maxRoe", "minRoe", "maxUnrealized", "minUnrealized", "slMoves", "hpMoves",
    "commission", "funding", "realizedPnl", "pnlIncludesFees", "durationSec",
];

function finite(value) {
    if (value == null || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function escapeRegex(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function historyWindow(query = {}, now = new Date()) {
    const preset = String(query.range || "3").trim().toLowerCase();
    if (preset === "custom") {
        const from = utcBound(query.from, false);
        const to = utcBound(query.to, true);
        if (from && to && from > to) throw httpError(400, "Ngày bắt đầu phải trước ngày kết thúc");
        return { preset, from, to: to || now };
    }
    if (preset === "today") {
        const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        return { preset, from, to: now };
    }
    // Mặc định 3 ngày, hỗ trợ 7, 30, 90 ngày
    const days = ["7", "30", "90"].includes(preset) ? Number(preset) : 3;
    return { preset: String(days), from: new Date(now.getTime() - days * DAY_MS), to: now };
}

function utcBound(value, end) {
    const text = String(value || "").trim();
    if (!text) return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) throw httpError(400, "Ngày không hợp lệ");
    return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0));
}

function tradeKey(row) {
    const open = row?.openTime ? new Date(row.openTime).toISOString() : `id:${row?._id || row?.id || ""}`;
    return [row?.env || "", row?.symbol || "", row?.side || "", open].join("|");
}

function collapseTrades(rows) {
    const byKey = new Map();
    const ordered = [...(rows || [])].sort((a, b) => {
        const left = new Date(a.updatedAt || a.closeTime || 0).getTime();
        const right = new Date(b.updatedAt || b.closeTime || 0).getTime();
        return right - left;
    });
    for (const row of ordered) {
        const key = tradeKey(row);
        if (!byKey.has(key)) byKey.set(key, row);
    }
    return [...byKey.values()];
}

/**
 * Nhãn lý do đóng — đồng bộ binance-bot formatCloseReason
 * (TP hết / SL dương / SL / tay / tín hiệu / max loss).
 */
function reasonLabel(reason) {
    const r = String(reason || "").trim().toUpperCase();
    if (!r) return "Không xác định";
    if (r === "TP_FILL" || r === "TP_ALL" || r === "TP_PARTIAL") return "Khớp hết TP";
    if (r === "SL_PROFIT" || r === "HSL_PROFIT" || r === "TRAIL_SL") return "Khớp SL dương";
    if (r === "SL_FILL" || r === "HSL_FILL" || r === "SL_LEFTOVER") return "Khớp SL";
    if (r === "MAX_LOSS" || r === "MAX_LOSS_SKIP_SIBLING" || r.includes("MAX_LOSS")) return "Max loss";
    if (r === "SIGNAL_CLOSE" || r.includes("SIGNAL")) return "Đóng theo tín hiệu";
    if (
        r === "MANUAL_CLOSE" ||
        r === "POSITION_GONE" ||
        r.includes("MANUAL") ||
        r.includes("COMMAND")
    ) {
        return "Người dùng tự đóng";
    }
    if (r === "DUST_BOTH") return "Khớp hết vị thế";
    if (r === "FETCH_FAIL" || r === "END_MONITOR") return "Đóng monitor";
    // Legacy / fuzzy (dữ liệu cũ)
    if (r.includes("TRAIL")) return "Khớp SL dương";
    if (r.includes("SL") || r.includes("STOP")) return "Khớp SL";
    if (r.includes("TP")) return "Khớp hết TP";
    if (r.includes("DUST") || r.includes("POSITION_GONE")) return "Người dùng tự đóng";
    return String(reason);
}

function reasonClause(reason) {
    const name = String(reason || "").trim().toLowerCase();
    if (name === "max_loss") return { closeReason: /MAX_LOSS/i };
    if (name === "signal") return { closeReason: /SIGNAL/i };
    if (name === "sl_profit" || name === "trailing") {
        return { closeReason: /SL_PROFIT|HSL_PROFIT|TRAIL_SL|TRAIL/i };
    }
    if (name === "sl") return { closeReason: /SL_FILL|HSL_FILL|SL_LEFTOVER/i };
    if (name === "manual" || name === "gone") {
        return { closeReason: /MANUAL|COMMAND|POSITION_GONE/i };
    }
    if (name === "tp") return { closeReason: /TP_FILL|TP_ALL|TP_PARTIAL|(^|_)TP($|_)/i };
    if (name === "unknown") {
        return {
            $or: [
                { closeReason: { $in: [null, "", "END_MONITOR", "FETCH_FAIL"] } },
                { closeReason: { $exists: false } },
            ],
        };
    }
    return null;
}

/** Khớp bộ lọc lý do đóng trên closeReason (dùng cho dòng Binance đã gắn config). */
function reasonMatches(closeReason, reason) {
    const name = String(reason || "").trim().toLowerCase();
    if (!name) return true;
    const r = String(closeReason || "");
    if (name === "max_loss") return /MAX_LOSS/i.test(r);
    if (name === "signal") return /SIGNAL/i.test(r);
    if (name === "sl_profit" || name === "trailing") return /SL_PROFIT|HSL_PROFIT|TRAIL_SL|TRAIL/i.test(r);
    if (name === "sl") return /SL_FILL|HSL_FILL|SL_LEFTOVER/i.test(r);
    if (name === "manual" || name === "gone") return /MANUAL|COMMAND|POSITION_GONE/i.test(r);
    if (name === "tp") return /TP_FILL|TP_ALL|TP_PARTIAL|(^|_)TP($|_)/i.test(r);
    if (name === "unknown") return !r.trim() || r === "END_MONITOR" || r === "FETCH_FAIL";
    return true;
}

const MATCH_CLOSE_MS = 45 * 60 * 1000;

function normalizeHistorySide(positionSide, fallback = "") {
    const side = String(positionSide || "").trim().toUpperCase();
    if (side === "LONG" || side === "SHORT") return side;
    const fb = String(fallback || "").trim().toUpperCase();
    if (fb === "LONG" || fb === "SHORT") return fb;
    return side === "BOTH" ? "BOTH" : "";
}

function encodeBinanceHistoryId(parts = {}) {
    const payload = [
        parts.account || "",
        String(parts.symbol || "").toUpperCase(),
        parts.side || "",
        String(parts.time || ""),
        parts.pnl == null || parts.pnl === "" ? "" : String(parts.pnl),
    ].join("|");
    return `bh_${Buffer.from(payload, "utf8").toString("base64url")}`;
}

function decodeBinanceHistoryId(id) {
    const text = String(id || "");
    if (!text.startsWith("bh_")) return null;
    try {
        const raw = Buffer.from(text.slice(3), "base64url").toString("utf8");
        const [account, symbol, side, time, pnl] = raw.split("|");
        return {
            account: account || "",
            symbol: symbol || "",
            side: side || "",
            time: Number(time),
            pnl: pnl === "" || pnl == null ? null : Number(pnl),
        };
    } catch {
        return null;
    }
}

/**
 * Gắn dòng Binance positionHistory với account_statics cùng account (env),
 * symbol/side và closeTime gần nhau — chỉ để biết config nào.
 */
function matchConfigToHistory(binanceRow, statics, accountEnvs) {
    const symbol = String(binanceRow?.symbol || "").toUpperCase();
    const side = normalizeHistorySide(binanceRow?.positionSide);
    const closeMs = Number(binanceRow?.time) || 0;
    if (!symbol || !closeMs || !accountEnvs?.length) return null;
    const envSet = new Set(accountEnvs.map((env) => String(env || "").trim()).filter(Boolean));
    const qty = finite(binanceRow?.closedVolume);
    const candidates = (statics || []).filter((row) => {
        if (!envSet.has(String(row?.env || "").trim())) return false;
        if (String(row?.symbol || "").toUpperCase() !== symbol) return false;
        const rowSide = String(row?.side || "").toUpperCase();
        if (side === "LONG" || side === "SHORT") {
            if (rowSide && rowSide !== side) return false;
        }
        const rowClose = new Date(row?.closeTime).getTime();
        if (!Number.isFinite(rowClose)) return false;
        return Math.abs(rowClose - closeMs) <= MATCH_CLOSE_MS;
    });
    if (!candidates.length) return null;
    candidates.sort((a, b) => {
        const da = Math.abs(new Date(a.closeTime).getTime() - closeMs);
        const db = Math.abs(new Date(b.closeTime).getTime() - closeMs);
        if (da !== db) return da - db;
        if (qty == null) return 0;
        const qa = finite(a.positionAmt);
        const qb = finite(b.positionAmt);
        const ea = qa == null ? 1e9 : Math.abs(Math.abs(qa) - Math.abs(qty));
        const eb = qb == null ? 1e9 : Math.abs(Math.abs(qb) - Math.abs(qty));
        return ea - eb;
    });
    return candidates[0];
}

function presentBinanceHistoryRow(row, account, match) {
    const profit = finite(row?.realizedPnl);
    const entry = finite(row?.entryPrice);
    const exit = finite(row?.avgClosePrice);
    const qty = finite(row?.closedVolume);
    const cost = match ? finite(match.costAmount) : null;
    const leverage = match ? finite(match.futuresLeverage) : null;
    let roe = match ? finite(match.roe) : null;
    if (roe == null && profit != null && cost != null && cost > 0) {
        roe = Math.round((profit / cost) * 10000) / 100;
    }
    const closeTime = row?.time ? new Date(Number(row.time)) : null;
    const openTime = match?.openTime || null;
    const side = normalizeHistorySide(row?.positionSide, match?.side);
    return {
        id: encodeBinanceHistoryId({
            account,
            symbol: row?.symbol,
            side,
            time: row?.time,
            pnl: profit,
        }),
        account: account || "",
        env: match?.env || "",
        signal: match?.typeSignal || "",
        symbol: String(row?.symbol || "").toUpperCase(),
        side: side === "BOTH" ? (match?.side || "") : side,
        entry,
        exit,
        qty,
        volume: null,
        leverage,
        cost,
        profit,
        roe,
        roeBasis: cost != null && cost > 0
            ? "realizedPnl Binance / costAmount config khớp"
            : "PnL từ Binance /fapi/v1/positionHistory",
        openTime,
        closeTime,
        holdMs: openTime && closeTime ? Math.max(0, closeTime.getTime() - new Date(openTime).getTime()) : null,
        closeReason: match?.closeReason || "",
        reasonLabel: match ? reasonLabel(match.closeReason) : "—",
        paper: false,
        copy: match?.isCopy === true,
        source: "binance_position_history",
        configMatched: Boolean(match?.env),
    };
}

function narrateTrade(row) {
    const logs = Array.isArray(row?.logs) ? row.logs : [];
    const events = new Set(logs.map((item) => String(item?.event || "")));
    const messages = logs.map((item) => String(item?.message || ""));
    const bits = [];
    if (events.has("OPEN_POSITION") || events.has("OPEN_ORDER")) bits.push("Có log mở lệnh");
    if (messages.some((item) => /TAKE_PROFIT|\bTP\d/i.test(item))) bits.push("Log có khớp TP");
    if (events.has("TRAIL_SL")) bits.push("Có lần dời SL theo trailing");
    if (events.has("HP_SL")) bits.push("Có lần dời SL theo HP");
    if (events.has("MAX_LOSS") || String(row?.closeReason || "").toUpperCase().includes("MAX_LOSS")) {
        bits.push("Đóng bởi max loss");
    } else if (String(row?.closeReason || "").toUpperCase().includes("SIGNAL")) {
        bits.push("Đóng theo tín hiệu");
    } else if (reasonLabel(row?.closeReason) !== "Không xác định") {
        bits.push(`Lý do đóng: ${reasonLabel(row.closeReason)}`);
    }
    if (!bits.length) return "Không đủ log để diễn giải diễn biến.";
    return `${bits.join(". ")}.`;
}

function rMultiple(row) {
    const entry = finite(row?.entryPrice);
    const sl = finite(row?.stats?.slPriceOpen);
    const qty = finite(row?.positionAmt);
    const profit = finite(row?.profit);
    if (entry == null || sl == null || qty == null || profit == null) return null;
    if (sl === 0 || qty === 0) return null;
    const risk = Math.abs(entry - sl) * Math.abs(qty);
    if (!(risk > 0)) return null;
    return Math.round((profit / risk) * 1000) / 1000;
}

function holdMs(row) {
    const open = new Date(row?.openTime).getTime();
    const close = new Date(row?.closeTime).getTime();
    if (!Number.isFinite(open) || !Number.isFinite(close)) return null;
    return Math.max(0, close - open);
}

function classifyProfit(value) {
    const n = finite(value);
    if (n == null) return "missing";
    if (n > 0) return "win";
    if (n < 0) return "loss";
    return "flat";
}

function emptySummary() {
    return {
        count: 0,
        wins: 0,
        losses: 0,
        flats: 0,
        missingProfit: 0,
        winRate: null,
        profit: null,
        avgWin: null,
        avgLoss: null,
        profitFactor: null,
        avgHoldMs: null,
    };
}

function summarizeBook(rows) {
    const summary = emptySummary();
    let profitSum = 0;
    let profitSeen = 0;
    let winSum = 0;
    let lossSum = 0;
    let holdSum = 0;
    let holdSeen = 0;
    for (const row of rows || []) {
        summary.count += 1;
        const kind = classifyProfit(row.profit);
        if (kind === "win") {
            summary.wins += 1;
            winSum += Number(row.profit);
        } else if (kind === "loss") {
            summary.losses += 1;
            lossSum += Number(row.profit);
        } else if (kind === "flat") summary.flats += 1;
        else summary.missingProfit += 1;
        if (kind !== "missing") {
            profitSum += Number(row.profit);
            profitSeen += 1;
        }
        const held = holdMs(row);
        if (held != null) {
            holdSum += held;
            holdSeen += 1;
        }
    }
    const rated = summary.wins + summary.losses + summary.flats;
    summary.winRate = rated ? (summary.wins / rated) * 100 : null;
    summary.profit = profitSeen ? Math.round(profitSum * 1000) / 1000 : null;
    summary.avgWin = summary.wins ? Math.round((winSum / summary.wins) * 1000) / 1000 : null;
    summary.avgLoss = summary.losses ? Math.round((lossSum / summary.losses) * 1000) / 1000 : null;
    summary.profitFactor = summary.wins && summary.losses ? Math.round((winSum / Math.abs(lossSum)) * 1000) / 1000 : null;
    summary.avgHoldMs = holdSeen ? Math.round(holdSum / holdSeen) : null;
    return summary;
}

function presentRow(row, account) {
    const profit = finite(row?.profit);
    const roe = finite(row?.roe);
    return {
        id: String(row?._id || row?.id || ""),
        account: account || "",
        env: row?.env || "",
        signal: row?.typeSignal || "",
        symbol: row?.symbol || "",
        side: row?.side || "",
        entry: finite(row?.entryPrice),
        exit: finite(row?.closePrice),
        qty: finite(row?.positionAmt),
        volume: finite(row?.volume),
        leverage: finite(row?.futuresLeverage),
        cost: finite(row?.costAmount),
        profit,
        roe,
        roeBasis: row?.isPaper ? "profit/cost của paper" : "biến động giá so với entry, không nhân đòn bẩy",
        openTime: row?.openTime || null,
        closeTime: row?.closeTime || null,
        holdMs: holdMs(row),
        closeReason: row?.closeReason || "",
        reasonLabel: reasonLabel(row?.closeReason),
        paper: row?.isPaper === true,
        copy: row?.isCopy === true,
    };
}

function snapshotOf(stats) {
    const source = stats && typeof stats === "object" ? stats : {};
    const out = {};
    for (const key of SNAPSHOT_KEYS) {
        if (source[key] != null) out[key] = source[key];
    }
    return out;
}

function readTrade(row, account) {
    const base = presentRow(row, account);
    const stats = snapshotOf(row?.stats);
    const includesFees = stats.pnlIncludesFees === true;
    return {
        ...base,
        logs: Array.isArray(row?.logs) ? row.logs.slice(-80) : [],
        stats,
        narrative: narrateTrade(row),
        rMultiple: rMultiple(row),
        rNote: "R = profit / (|entry − SL mở| × |qty|) khi có stats.slPriceOpen khác 0. Không dùng SL cuối.",
        costs: {
            profit: base.profit,
            realized: finite(stats.realizedPnl),
            commission: finite(stats.commission),
            funding: finite(stats.funding),
            includesFees,
            note: includesFees
                ? "profit đã gồm realized, commission và funding theo income của symbol từ lúc mở. Không trừ phí thêm lần nữa."
                : "Chưa thấy cờ pnlIncludesFees. profit là số bot đã lưu, không gọi là lãi ròng.",
        },
        observed: {
            maxRoe: finite(stats.maxRoe),
            minRoe: finite(stats.minRoe),
            maxUnrealized: finite(stats.maxUnrealized),
            minUnrealized: finite(stats.minUnrealized),
            note: "Mức cao nhất và thấp nhất monitor đã ghi trong lúc giữ lệnh, không phải toàn bộ biến động sàn.",
        },
        source: "account_statics",
        missing: [
            base.profit == null ? "profit" : null,
            base.exit == null ? "giá đóng" : null,
            !row?.logs?.length ? "logs" : null,
            !includesFees ? "tách phí/funding" : null,
            finite(stats.maxRoe) == null ? "ROE quan sát" : null,
        ].filter(Boolean),
    };
}

function bookOf(value) {
    const book = String(value || "").trim().toLowerCase();
    if (book === "paper" || book === "all") return book;
    return "live";
}

async function historyBots(actor, audience) {
    return usersForAudience(actor, audience === "all" ? "all" : "mine", PERMISSIONS.STATISTICS_VIEW);
}

function envAccount(bots) {
    const map = new Map();
    for (const bot of bots || []) {
        for (const env of bot.accounts || []) {
            const name = String(env || "").trim();
            if (name && !map.has(name)) map.set(name, bot.username);
        }
    }
    return map;
}

function sortPresented(rows, sortKey, dir) {
    return [...(rows || [])].sort((a, b) => {
        const left = sortKey === "holdMs"
            ? (a.holdMs != null ? a.holdMs : holdMs(a))
            : sortKey === "profit"
                ? finite(a.profit)
                : new Date(a.closeTime).getTime();
        const right = sortKey === "holdMs"
            ? (b.holdMs != null ? b.holdMs : holdMs(b))
            : sortKey === "profit"
                ? finite(b.profit)
                : new Date(b.closeTime).getTime();
        if (left == null && right == null) return 0;
        if (left == null) return 1;
        if (right == null) return -1;
        return left === right ? 0 : (left > right ? dir : -dir);
    });
}

function passesPresentedFilters(row, query = {}) {
    const side = String(query.side || "").trim().toUpperCase();
    if ((side === "LONG" || side === "SHORT") && String(row.side || "").toUpperCase() !== side) return false;
    const symbol = String(query.symbol || "").trim();
    if (symbol && !new RegExp(escapeRegex(symbol), "i").test(row.symbol || "")) return false;
    const signal = String(query.signal || "").trim();
    if (signal && !new RegExp(`^${escapeRegex(signal)}$`, "i").test(row.signal || "")) return false;
    const copy = String(query.copy || "").trim().toLowerCase();
    if (copy === "copy" && row.copy !== true) return false;
    if (copy === "manual" && row.copy === true) return false;
    const profit = String(query.profit || "").trim().toLowerCase();
    const pnl = finite(row.profit);
    if (profit === "win" && !(pnl > 0)) return false;
    if (profit === "loss" && !(pnl < 0)) return false;
    if (profit === "flat" && pnl !== 0) return false;
    const reason = String(query.reason || "").trim().toLowerCase();
    if (reason) {
        if (reason === "unknown") {
            if (row.configMatched && !reasonMatches(row.closeReason, "unknown")) return false;
            // chưa khớp config → coi là unknown
        } else if (!row.configMatched || !reasonMatches(row.closeReason, reason)) {
            return false;
        }
    }
    const env = String(query.env || "").trim();
    if (env && row.env !== env) return false;
    return true;
}

async function loadConfigStaticsForMatch(envs, window) {
    const list = envs.length ? envs : ["__none__"];
    return AccountStatic.find({
        env: { $in: list },
        isPaper: { $ne: true },
        closeTime: {
            $gte: new Date(window.from.getTime() - MATCH_CLOSE_MS),
            $lte: new Date(window.to.getTime() + MATCH_CLOSE_MS),
        },
    })
        .select("env symbol side typeSignal closeReason closeTime openTime entryPrice closePrice positionAmt profit roe isCopy futuresLeverage costAmount")
        .lean();
}

async function listBinanceLiveHistory(selected, owners, window, query, errors) {
    const { getExchangeAdapter } = require("./exchanges");
    const { eachLimit } = require("./positions");
    const envFilter = String(query.env || "").trim();
    const envs = envFilter ? [envFilter] : [...owners.keys()];
    const statics = await loadConfigStaticsForMatch(envs, window);
    const accounts = selected.map((bot) => bot.username);
    const fetched = await eachLimit(
        accounts,
        1,
        async (username) => {
            try {
                const adapter = await getExchangeAdapter(username);
                if (!adapter.capabilities().history) {
                    return { username, rows: [], unsupported: true };
                }
                if (typeof adapter.fetchPositionHistory !== "function") {
                    return { username, rows: [], unsupported: true };
                }
                const rows = await adapter.fetchPositionHistory({
                    startTime: window.from.getTime(),
                    endTime: window.to.getTime(),
                    limit: 100,
                });
                return { username, rows: Array.isArray(rows) ? rows : [] };
            } catch (error) {
                console.error("[listPositionHistory]", username, error.message);
                return { username, rows: [], error: error.message || "Không lấy được positionHistory" };
            }
        },
        { gapMs: 400 }
    );

    const presented = [];
    for (const item of fetched) {
        if (item.error) errors.push({ account: item.username, error: item.error });
        // Sàn không có positionHistory: bỏ qua im lặng (tab này ưu tiên Binance).
        if (item.unsupported) continue;
        const bot = selected.find((row) => row.username === item.username);
        const accountEnvs = (bot?.accounts || []).map((name) => String(name || "").trim()).filter(Boolean);
        for (const row of item.rows || []) {
            const t = Number(row.time);
            if (Number.isFinite(t) && (t < window.from.getTime() || t > window.to.getTime())) continue;
            const match = matchConfigToHistory(row, statics, accountEnvs);
            const presentedRow = presentBinanceHistoryRow(row, item.username, match);
            if (!passesPresentedFilters(presentedRow, query)) continue;
            presented.push(presentedRow);
        }
    }
    return presented;
}

async function listPaperHistoryMongo(owners, window, query) {
    const env = String(query.env || "").trim();
    const envs = env ? [env] : [...owners.keys()];
    const match = {
        env: { $in: envs.length ? envs : ["__none__"] },
        closeTime: { $gte: window.from, $lte: window.to },
        isPaper: true,
    };
    const side = String(query.side || "").trim().toUpperCase();
    if (side === "LONG" || side === "SHORT") match.side = side;
    const symbol = String(query.symbol || "").trim();
    if (symbol) match.symbol = new RegExp(escapeRegex(symbol), "i");
    const signal = String(query.signal || "").trim();
    if (signal) match.typeSignal = new RegExp(`^${escapeRegex(signal)}$`, "i");
    const copy = String(query.copy || "").trim().toLowerCase();
    if (copy === "copy") match.isCopy = true;
    else if (copy === "manual") match.isCopy = { $ne: true };
    const profit = String(query.profit || "").trim().toLowerCase();
    if (profit === "win") match.profit = { $gt: 0 };
    else if (profit === "loss") match.profit = { $lt: 0 };
    else if (profit === "flat") match.profit = 0;
    const reason = reasonClause(query.reason);
    if (reason) Object.assign(match, reason);
    const grouped = await AccountStatic.aggregate([
        { $match: match },
        { $project: { logs: 0 } },
        { $sort: { updatedAt: -1, _id: -1 } },
        { $group: { _id: { env: "$env", symbol: "$symbol", side: "$side", open: { $ifNull: ["$openTime", "$_id"] } }, doc: { $first: "$$ROOT" } } },
        { $replaceRoot: { newRoot: "$doc" } },
    ]);
    return collapseTrades(grouped).map((row) => {
        const presented = presentRow(row, owners.get(row.env) || "");
        presented.source = "account_statics";
        presented.configMatched = Boolean(row.env);
        return presented;
    });
}

async function listPositionHistory(actor, query = {}) {
    const bots = await historyBots(actor, query.audience);
    const account = String(query.account || "").trim();
    const selected = account ? bots.filter((bot) => bot.username === account) : bots;
    if (account && !selected.length) throw httpError(403, "Không có quyền thống kê tài khoản này");
    const owners = envAccount(selected);
    const env = String(query.env || "").trim();
    if (env && !owners.has(env)) throw httpError(404, "Config không thuộc các tài khoản đang xem");
    const window = historyWindow(query);
    const book = bookOf(query.book);
    const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
    const dir = query.dir === "asc" ? 1 : -1;
    const sortKey = query.sort === "pnl" ? "profit" : query.sort === "hold" ? "holdMs" : "closeTime";
    const errors = [];

    let liveRows = [];
    let paperRows = [];
    if (book !== "paper") {
        liveRows = await listBinanceLiveHistory(selected, owners, window, query, errors);
    }
    if (book !== "live") {
        paperRows = await listPaperHistoryMongo(owners, window, query);
    }

    const rows = book === "paper" ? paperRows : book === "all" ? [...liveRows, ...paperRows] : liveRows;
    const sorted = sortPresented(rows, sortKey, dir);
    const slice = sorted.slice((page - 1) * PAGE_LIMIT, page * PAGE_LIMIT);
    return {
        accounts: bots.map((bot) => ({ username: bot.username, accounts: bot.accounts || [] })),
        rows: slice,
        page,
        limit: PAGE_LIMIT,
        total: rows.length,
        range: { preset: window.preset, from: window.from, to: window.to },
        book,
        separateBooks: true,
        source: book === "paper" ? "account_statics" : "binance_position_history",
        errors,
        summaries: {
            live: book === "paper" ? null : summarizeBook(liveRows),
            paper: book === "live" ? null : summarizeBook(paperRows),
        },
        formula: {
            winRate: "Thắng / (thắng + thua + hòa). Lệnh không có PnL không đưa vào mẫu số.",
            profitFactor: "Tổng PnL dương / trị tuyệt đối tổng PnL âm. Thiếu một trong hai nhóm thì để trống.",
            pnl: "Live: realizedPnl từ Binance /fapi/v1/positionHistory. Paper: profit đã lưu trên account_statics. Không cộng live với paper. Cột config/signal chỉ gắn khi khớp account_statics.",
            hold: "Trung bình closeTime − openTime khi có giờ mở từ config khớp (live) hoặc account_statics (paper).",
        },
    };
}

async function readBinanceTrade(row, account, match, actor, bots) {
    let full = match;
    if (match?._id) {
        try {
            const loaded = await AccountStatic.findById(match._id).lean();
            if (loaded) full = loaded;
        } catch (error) {
            console.error("[getPositionHistory] load static", error.message);
        }
    }
    const base = presentBinanceHistoryRow(row, account, full || match);
    const stats = snapshotOf(full?.stats);
    const includesFees = stats.pnlIncludesFees === true;
    const canConfig = hasPermission(actor, PERMISSIONS.CONFIG_VIEW)
        && bots.some((bot) => bot.username === account && canAccessResource(actor, PERMISSIONS.CONFIG_VIEW, bot));
    let monitorId = null;
    if (full?.openTime && full?.env) {
        const monitor = await MonitorPosition.findOne({
            env: full.env,
            symbol: full.symbol,
            side: full.side,
            startTime: full.openTime,
        }).select("_id").lean();
        if (monitor && hasPermission(actor, PERMISSIONS.POSITIONS_VIEW)) monitorId = String(monitor._id);
    }
    return {
        ...base,
        logs: Array.isArray(full?.logs) ? full.logs.slice(-80) : [],
        stats,
        narrative: full
            ? narrateTrade(full)
            : "Dữ liệu từ Binance /fapi/v1/positionHistory. Chưa khớp config trên account_statics.",
        rMultiple: full ? rMultiple(full) : null,
        rNote: "R = profit / (|entry − SL mở| × |qty|) khi có stats.slPriceOpen khác 0 từ config khớp.",
        costs: {
            profit: base.profit,
            realized: finite(row?.realizedPnl),
            commission: finite(row?.commission),
            funding: finite(row?.fundingFee),
            includesFees,
            note: "PnL chính từ Binance Position History (realizedPnl). Config chỉ để biết env/signal/lý do đóng.",
        },
        observed: {
            maxRoe: finite(stats.maxRoe),
            minRoe: finite(stats.minRoe),
            maxUnrealized: finite(stats.maxUnrealized),
            minUnrealized: finite(stats.minUnrealized),
            note: "Mức cao/thấp monitor ghi khi có config khớp; không phải toàn bộ biến động sàn.",
        },
        source: "binance_position_history",
        missing: [
            base.profit == null ? "realizedPnl" : null,
            base.exit == null ? "giá đóng" : null,
            !base.env ? "config" : null,
            !(full?.logs?.length) ? "logs" : null,
        ].filter(Boolean),
        links: {
            config: canConfig && base.env
                ? `/bots/${encodeURIComponent(account)}/accounts/${encodeURIComponent(base.env)}`
                : null,
            monitorId,
        },
    };
}

async function getBinancePositionHistoryDetail(actor, decoded, query = {}) {
    const bots = await historyBots(actor, query.audience);
    const bot = bots.find((row) => row.username === decoded.account);
    if (!bot) throw httpError(404, "Không tìm thấy giao dịch");
    const { getExchangeAdapter } = require("./exchanges");
    let rows = [];
    try {
        const adapter = await getExchangeAdapter(decoded.account);
        if (!adapter.capabilities().history || typeof adapter.fetchPositionHistory !== "function") {
            throw httpError(404, "Sàn không hỗ trợ positionHistory");
        }
        const t = Number(decoded.time);
        const center = Number.isFinite(t) ? t : Date.now();
        rows = await adapter.fetchPositionHistory({
            startTime: center - DAY_MS,
            endTime: center + DAY_MS,
            limit: 100,
        });
    } catch (error) {
        if (error.status) throw error;
        console.error("[getPositionHistory]", decoded.account, error.message);
        throw httpError(502, error.message || "Không lấy được positionHistory");
    }
    const symbol = String(decoded.symbol || "").toUpperCase();
    const found = (rows || []).find((row) => {
        if (String(row.symbol || "").toUpperCase() !== symbol) return false;
        if (Number(row.time) !== Number(decoded.time)) return false;
        const side = normalizeHistorySide(row.positionSide);
        if (decoded.side && side && side !== "BOTH" && decoded.side !== "BOTH" && side !== decoded.side) return false;
        if (decoded.pnl != null && Number.isFinite(decoded.pnl)) {
            const pnl = finite(row.realizedPnl);
            if (pnl != null && pnl !== decoded.pnl) return false;
        }
        return true;
    });
    if (!found) throw httpError(404, "Không tìm thấy giao dịch trên Binance");
    const owners = envAccount([bot]);
    const statics = await loadConfigStaticsForMatch([...owners.keys()], {
        from: new Date(Number(decoded.time) - MATCH_CLOSE_MS),
        to: new Date(Number(decoded.time) + MATCH_CLOSE_MS),
    });
    const match = matchConfigToHistory(found, statics, bot.accounts || []);
    return readBinanceTrade(found, decoded.account, match, actor, bots);
}

async function getPositionHistory(actor, id, query = {}) {
    const decoded = decodeBinanceHistoryId(id);
    if (decoded) return getBinancePositionHistoryDetail(actor, decoded, query);
    if (!/^[a-f0-9]{24}$/i.test(String(id || ""))) throw httpError(400, "Mã giao dịch không hợp lệ");
    const bots = await historyBots(actor, query.audience);
    const owners = envAccount(bots);
    const row = await AccountStatic.findById(id).lean();
    if (!row || !owners.has(row.env)) throw httpError(404, "Không tìm thấy giao dịch");
    const account = owners.get(row.env);
    const trade = readTrade(row, account);
    const monitor = row.openTime
        ? await MonitorPosition.findOne({ env: row.env, symbol: row.symbol, side: row.side, startTime: row.openTime }).select("_id").lean()
        : null;
    trade.links = {
        config: hasPermission(actor, PERMISSIONS.CONFIG_VIEW) && bots.some((bot) => bot.username === account && canAccessResource(actor, PERMISSIONS.CONFIG_VIEW, bot))
            ? `/bots/${encodeURIComponent(account)}/accounts/${encodeURIComponent(row.env)}`
            : null,
        monitorId: monitor && hasPermission(actor, PERMISSIONS.POSITIONS_VIEW) ? String(monitor._id) : null,
    };
    return trade;
}

module.exports = {
    historyWindow,
    collapseTrades,
    tradeKey,
    summarizeBook,
    narrateTrade,
    rMultiple,
    reasonLabel,
    reasonMatches,
    readTrade,
    normalizeHistorySide,
    encodeBinanceHistoryId,
    decodeBinanceHistoryId,
    matchConfigToHistory,
    presentBinanceHistoryRow,
    listPositionHistory,
    getPositionHistory,
};
