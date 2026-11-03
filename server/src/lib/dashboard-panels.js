/**
 * Panel Tổng quan: recentTrades (timeline) + allocation (donut).
 * Không gọi REST sàn — chỉ Mongo account_statics + sổ Redis đã có.
 */

const { positionIdentity } = require("./exchanges/normalizers");

const TRADE_LOOKBACK_DAYS = 7;
const TRADE_LIMIT = 8;
const DAY_MS = 24 * 60 * 60 * 1000;

function finite(value) {
    if (value == null || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function round2(value) {
    const n = finite(value);
    return n == null ? null : Math.round(n * 100) / 100;
}

function envKey(value) {
    return String(value || "").trim().toUpperCase();
}

function normalizeTradeKind(raw) {
    const kind = String(raw || "all").trim().toLowerCase();
    if (kind === "open" || kind === "close") return kind;
    return "all";
}

function normalizeSide(raw) {
    const side = String(raw || "").trim().toUpperCase();
    if (side === "LONG" || side === "SHORT") return side;
    return "";
}

/**
 * Notional USDT từ vị thế sổ đã chuẩn hóa.
 * Contracts thiếu baseQuantity/notional → null (loại khỏi tổng, không coi 0).
 */
function positionNotionalUsdt(row) {
    const direct = finite(row?.notional);
    if (direct != null && direct > 0) return direct;

    const mark = finite(row?.markPrice ?? row?.mark);
    if (mark == null || !(mark > 0)) return null;

    const unit = String(row?.quantityUnit || "base").toLowerCase();
    if (unit === "contracts") {
        const base = finite(row?.baseQuantity);
        if (base == null || !(base > 0)) return null;
        return base * mark;
    }

    const baseQty = finite(row?.baseQuantity);
    if (baseQty != null && baseQty > 0) return baseQty * mark;

    const qty = Math.abs(finite(row?.quantity) ?? finite(row?.positionAmt) ?? 0);
    if (!(qty > 0)) return null;
    return qty * mark;
}

function positionSideOf(row) {
    const direct = normalizeSide(row?.side || row?.positionSide);
    if (direct) return direct;
    const amt = finite(row?.positionAmt);
    if (amt == null || amt === 0) return "";
    return amt < 0 ? "SHORT" : "LONG";
}

function ownerOf(bots, env) {
    const key = envKey(env);
    return bots.find((bot) => (bot.accounts || []).some((item) => envKey(item) === key)) || null;
}

/**
 * Gate open: producer/monitor_positions trong repo web-bot không chứng minh được
 * openTime = giờ khớp lệnh (vs nhận signal). Chỉ bàn giao Đóng từ account_statics.
 */
const OPEN_SUPPORTED = false;
const OPEN_LIMITATION =
    "Chưa chứng minh nguồn mở lệnh đáng tin (openTime/monitor_positions). Timeline chỉ Đóng từ account_statics Live.";

function closedLiveFilter(envs, from, to) {
    return {
        env: { $in: envs },
        isPaper: { $ne: true },
        closeTime: { $gte: from, $lte: to },
        $or: [
            { isClosed: true },
            { closeTime: { $exists: true, $ne: null } },
        ],
    };
}

function presentCloseEvent(row, bots) {
    const env = String(row.env || "").trim();
    const bot = ownerOf(bots, env);
    if (!bot) return null;
    const closeAt = row.closeTime ? new Date(row.closeTime) : null;
    if (!closeAt || !Number.isFinite(closeAt.getTime())) return null;
    const symbol = String(row.symbol || "").trim().toUpperCase();
    const side = normalizeSide(row.side);
    const signal = String(row.typeSignal || "").trim().toUpperCase();
    const idBase = String(row._id || `${env}|${symbol}|${side}|${closeAt.toISOString()}`);
    const profitRaw = row.profit;
    const profit = profitRaw == null || profitRaw === "" ? null : round2(profitRaw);
    const qs = new URLSearchParams({
        tab: "performance",
        username: bot.username,
        range: "7",
        analytics: "1",
        book: "live",
    });
    if (symbol) qs.set("symbol", symbol);
    if (env) qs.set("env", env);
    return {
        id: `close:${idBase}`,
        kind: "close",
        at: closeAt.toISOString(),
        username: bot.username,
        env,
        exchange: null,
        instrumentId: symbol || null,
        symbol: symbol || null,
        side: side || null,
        signal: signal || null,
        profit,
        href: `/reports?${qs}`,
    };
}

/**
 * @param {{ kind?: string, bots: object[], closes: object[], now?: Date }} input
 */
function buildRecentTrades({ kind = "all", bots = [], closes = [], now = new Date() } = {}) {
    const tradeKind = normalizeTradeKind(kind);
    const asOf = (now instanceof Date ? now : new Date(now)).toISOString();
    const base = {
        kind: tradeKind,
        lookbackDays: TRADE_LOOKBACK_DAYS,
        limit: TRADE_LIMIT,
        source: "bot_records",
        openSupported: OPEN_SUPPORTED,
        openLimitation: OPEN_LIMITATION,
        items: [],
        asOf,
    };

    if (tradeKind === "open" && !OPEN_SUPPORTED) {
        return base;
    }

    const events = [];
    for (const row of closes || []) {
        const event = presentCloseEvent(row, bots);
        if (event) events.push(event);
    }

    events.sort((a, b) => {
        const ta = new Date(a.at).getTime();
        const tb = new Date(b.at).getTime();
        if (tb !== ta) return tb - ta;
        return String(a.id).localeCompare(String(b.id));
    });

    const filtered = tradeKind === "close" || tradeKind === "all"
        ? events
        : events.filter((row) => row.kind === tradeKind);

    return {
        ...base,
        items: filtered.slice(0, TRADE_LIMIT),
    };
}

function bookAsOfMs(book) {
    const candidates = [book?.reconciledAt, book?.at, book?.checkedAt];
    let best = null;
    for (const value of candidates) {
        const t = new Date(value).getTime();
        if (Number.isFinite(t)) best = best == null ? t : Math.min(best, t);
    }
    return best;
}

/**
 * Phân bổ gross notional từ toàn bộ parent position trong sổ scope.
 * Không lấy top uPnL; dedupe theo positionIdentity.
 */
function buildAllocation({ usernames = [], books = null, now = new Date() } = {}) {
    const names = Array.isArray(usernames) ? usernames.filter(Boolean) : [];
    const asOfIso = (now instanceof Date ? now : new Date(now)).toISOString();
    const empty = {
        basis: "gross_notional",
        unit: "USDT",
        quality: "unavailable",
        stale: false,
        asOf: asOfIso,
        coverage: {
            accountsExpected: names.length,
            accountsAvailable: 0,
            positionsSeen: 0,
            positionsIncluded: 0,
            positionsExcluded: 0,
        },
        gross: null,
        bySymbol: [],
        bySide: [
            { key: "LONG", value: 0 },
            { key: "SHORT", value: 0 },
        ],
        rows: [],
        excludedReasons: [],
    };

    if (!names.length) return empty;
    if (books == null || typeof books !== "object") return empty;

    const seen = new Set();
    const rows = [];
    const excludedReasons = [];
    let accountsAvailable = 0;
    let positionsSeen = 0;
    let positionsExcluded = 0;
    let stale = false;
    let oldestMs = null;

    for (const username of names) {
        const book = books[username];
        if (!book || !Array.isArray(book.positions)) continue;
        accountsAvailable += 1;
        if (book.stale === true || book.status === "stale") stale = true;
        const bookMs = bookAsOfMs(book);
        if (bookMs != null) oldestMs = oldestMs == null ? bookMs : Math.min(oldestMs, bookMs);

        for (const raw of book.positions) {
            const qtyProbe = Math.abs(finite(raw?.positionAmt) ?? finite(raw?.quantity) ?? 0);
            if (!(qtyProbe > 0) && !(finite(raw?.baseQuantity) > 0) && !(finite(raw?.notional) > 0)) {
                continue;
            }
            positionsSeen += 1;
            const exchange = raw.exchange || book.exchange || null;
            const instrumentId = String(raw.instrumentId || raw.symbol || "").trim().toUpperCase();
            const symbol = String(raw.symbol || instrumentId || "").trim().toUpperCase();
            const side = positionSideOf(raw);
            if (!side) {
                positionsExcluded += 1;
                excludedReasons.push("missing_side");
                continue;
            }
            if (!instrumentId && !symbol) {
                positionsExcluded += 1;
                excludedReasons.push("missing_instrument");
                continue;
            }
            const identity = positionIdentity({
                account: username,
                exchange,
                instrumentId: instrumentId || symbol,
                symbol,
                side,
                positionIdx: raw.positionIdx,
            });
            if (seen.has(identity)) continue;
            seen.add(identity);

            const notional = positionNotionalUsdt(raw);
            if (notional == null || !(notional > 0)) {
                positionsExcluded += 1;
                if (String(raw.quantityUnit || "").toLowerCase() === "contracts") {
                    excludedReasons.push("contracts_without_base");
                } else {
                    excludedReasons.push("missing_mark_or_qty");
                }
                continue;
            }

            rows.push({
                account: username,
                exchange: exchange || null,
                instrumentId: instrumentId || symbol,
                symbol: symbol || instrumentId,
                side,
                notional,
                href: `/terminal?account=${encodeURIComponent(username)}`,
            });
        }
    }

    const positionsIncluded = rows.length;
    const gross = rows.reduce((sum, row) => sum + row.notional, 0);
    const bySymbolMap = new Map();
    let longNotional = 0;
    let shortNotional = 0;
    for (const row of rows) {
        const key = row.symbol || row.instrumentId;
        const prev = bySymbolMap.get(key) || { key, label: key, value: 0 };
        prev.value += row.notional;
        bySymbolMap.set(key, prev);
        if (row.side === "LONG") longNotional += row.notional;
        else if (row.side === "SHORT") shortNotional += row.notional;
    }

    const bySymbol = [...bySymbolMap.values()]
        .map((row) => ({ key: row.key, label: row.label, value: round2(row.value) }))
        .sort((a, b) => (b.value || 0) - (a.value || 0) || String(a.key).localeCompare(String(b.key)));

    const detailRows = rows.map((row) => ({
        account: row.account,
        exchange: row.exchange,
        instrumentId: row.instrumentId,
        symbol: row.symbol,
        side: row.side,
        notional: round2(row.notional),
        share: gross > 0 ? Math.round((row.notional / gross) * 1000) / 10 : null,
        href: row.href,
    }));

    let quality = "complete";
    if (accountsAvailable === 0) quality = "unavailable";
    else if (accountsAvailable < names.length || positionsExcluded > 0) quality = "partial";

    return {
        basis: "gross_notional",
        unit: "USDT",
        quality,
        stale,
        asOf: oldestMs != null ? new Date(oldestMs).toISOString() : asOfIso,
        coverage: {
            accountsExpected: names.length,
            accountsAvailable,
            positionsSeen,
            positionsIncluded,
            positionsExcluded,
        },
        gross: quality === "unavailable" ? null : round2(gross),
        bySymbol,
        bySide: [
            { key: "LONG", value: round2(longNotional) || 0 },
            { key: "SHORT", value: round2(shortNotional) || 0 },
        ],
        rows: detailRows,
        excludedReasons: [...new Set(excludedReasons)],
    };
}

module.exports = {
    TRADE_LOOKBACK_DAYS,
    TRADE_LIMIT,
    OPEN_SUPPORTED,
    OPEN_LIMITATION,
    normalizeTradeKind,
    normalizeSide,
    positionNotionalUsdt,
    closedLiveFilter,
    buildRecentTrades,
    buildAllocation,
};
