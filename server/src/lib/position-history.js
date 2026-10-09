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
    const preset = String(query.range || "30").trim().toLowerCase();
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
    const days = preset === "7" || preset === "90" ? Number(preset) : 30;
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

function reasonLabel(reason) {
    const text = String(reason || "").trim().toUpperCase();
    if (!text || text === "END_MONITOR") return "Không xác định";
    if (text.includes("MAX_LOSS")) return "Max loss";
    if (text.includes("SIGNAL")) return "Signal";
    if (text.includes("TRAIL")) return "Trailing";
    if (text.includes("SL") || text.includes("STOP")) return "SL";
    if (text.includes("MANUAL") || text.includes("COMMAND")) return "Thủ công";
    if (text.includes("POSITION_GONE") || text.includes("DUST")) return "Hết vị thế trên sàn";
    if (text.includes("TP")) return "TP";
    return text;
}

function reasonClause(reason) {
    const name = String(reason || "").trim().toLowerCase();
    if (name === "max_loss") return { closeReason: /MAX_LOSS/i };
    if (name === "signal") return { closeReason: /SIGNAL/i };
    if (name === "trailing") return { closeReason: /TRAIL/i };
    if (name === "sl") return { closeReason: /SL|STOP/i };
    if (name === "manual") return { closeReason: /MANUAL|COMMAND/i };
    if (name === "gone") return { closeReason: /POSITION_GONE|DUST_/i };
    if (name === "tp") return { closeReason: /TP/i };
    if (name === "unknown") return { $or: [{ closeReason: { $in: [null, "", "END_MONITOR"] } }, { closeReason: { $exists: false } }] };
    return null;
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
    if (events.has("MAX_LOSS") || String(row?.closeReason || "").toUpperCase().includes("MAX_LOSS")) bits.push("Đóng bởi max loss");
    else if (String(row?.closeReason || "").toUpperCase().includes("SIGNAL")) bits.push("Đóng theo signal");
    else if (reasonLabel(row?.closeReason) !== "Không xác định") bits.push(`Lý do đóng đã ghi: ${reasonLabel(row.closeReason)}`);
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

async function listPositionHistory(actor, query = {}) {
    const bots = await historyBots(actor, query.audience);
    const account = String(query.account || "").trim();
    const selected = account ? bots.filter((bot) => bot.username === account) : bots;
    if (account && !selected.length) throw httpError(403, "Không có quyền thống kê tài khoản này");
    const owners = envAccount(selected);
    const env = String(query.env || "").trim();
    const envs = env ? [env] : [...owners.keys()];
    if (env && !owners.has(env)) throw httpError(404, "Config không thuộc các tài khoản đang xem");
    const window = historyWindow(query);
    const book = bookOf(query.book);
    const match = {
        env: { $in: envs.length ? envs : ["__none__"] },
        closeTime: { $gte: window.from, $lte: window.to },
    };
    if (book === "paper") match.isPaper = true;
    else if (book === "live") match.isPaper = { $ne: true };
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
    const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
    const dir = query.dir === "asc" ? 1 : -1;
    const sortKey = query.sort === "pnl" ? "profit" : query.sort === "hold" ? "holdMs" : "closeTime";
    const grouped = await AccountStatic.aggregate([
        { $match: match },
        { $project: { logs: 0 } },
        { $sort: { updatedAt: -1, _id: -1 } },
        { $group: { _id: { env: "$env", symbol: "$symbol", side: "$side", open: { $ifNull: ["$openTime", "$_id"] } }, doc: { $first: "$$ROOT" } } },
        { $replaceRoot: { newRoot: "$doc" } },
    ]);
    const rows = collapseTrades(grouped);
    const liveRows = rows.filter((row) => row.isPaper !== true);
    const paperRows = rows.filter((row) => row.isPaper === true);
    const sorted = [...rows].sort((a, b) => {
        const left = sortKey === "holdMs" ? holdMs(a) : sortKey === "profit" ? finite(a.profit) : new Date(a.closeTime).getTime();
        const right = sortKey === "holdMs" ? holdMs(b) : sortKey === "profit" ? finite(b.profit) : new Date(b.closeTime).getTime();
        if (left == null && right == null) return 0;
        if (left == null) return 1;
        if (right == null) return -1;
        return left === right ? 0 : (left > right ? dir : -dir);
    });
    const slice = sorted.slice((page - 1) * PAGE_LIMIT, page * PAGE_LIMIT);
    return {
        accounts: bots.map((bot) => ({ username: bot.username, accounts: bot.accounts || [] })),
        rows: slice.map((row) => presentRow(row, owners.get(row.env) || "")),
        page,
        limit: PAGE_LIMIT,
        total: rows.length,
        range: { preset: window.preset, from: window.from, to: window.to },
        book,
        separateBooks: true,
        summaries: {
            live: book === "paper" ? null : summarizeBook(liveRows),
            paper: book === "live" ? null : summarizeBook(paperRows),
        },
        formula: {
            winRate: "Thắng / (thắng + thua + hòa). Lệnh không có profit không đưa vào mẫu số.",
            profitFactor: "Tổng profit dương / trị tuyệt đối tổng profit âm. Thiếu một trong hai nhóm thì để trống.",
            pnl: "Tổng field profit đã lưu trên account_statics. Lệnh live là realized + commission + funding theo symbol từ lúc mở. Không cộng live với paper.",
            hold: "Trung bình closeTime − openTime của lệnh có đủ cả hai mốc.",
        },
    };
}

async function getPositionHistory(actor, id, query = {}) {
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
    readTrade,
    listPositionHistory,
    getPositionHistory,
};
