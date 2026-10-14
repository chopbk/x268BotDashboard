/**
 * Binance Smart Signal (bapi) — web endpoint không có docs chính thức.
 * Semantics tham khảo MIT repo 0xBennie; triển khai lại, null-safe.
 */
const { smartMoneyFetch } = require("../http");
const { finite } = require("../formulas");

const PATH = "/bapi/futures/v1/public/future/smart-money/signal/overview";

function intOrNull(value) {
    if (value == null || value === "") return null;
    const n = parseInt(String(value), 10);
    return Number.isFinite(n) ? n : null;
}

function parseOverview(raw) {
    if (!raw || typeof raw !== "object") return null;
    const signalDay = raw.updateTime != null ? Number(raw.updateTime) : null;
    return {
        signalDay: Number.isFinite(signalDay) && signalDay > 0 ? signalDay : null,
        cohortId: Number.isFinite(signalDay) && signalDay > 0 ? `sd:${signalDay}` : null,
        sourceUpdatedAt: Number.isFinite(signalDay) && signalDay > 0 ? new Date(signalDay).toISOString() : null,
        totalPositions: finite(raw.totalPositions),
        totalTraders: intOrNull(raw.totalTraders),
        longShortRatio: finite(raw.longShortRatio),
        traders: {
            longCount: intOrNull(raw.longTraders),
            shortCount: intOrNull(raw.shortTraders),
            longQty: finite(raw.longTradersQty),
            shortQty: finite(raw.shortTradersQty),
            longAvgEntry: finite(raw.longTradersAvgEntryPrice),
            shortAvgEntry: finite(raw.shortTradersAvgEntryPrice),
            longProfitCount: intOrNull(raw.longProfitTraders),
            shortProfitCount: intOrNull(raw.shortProfitTraders),
        },
        whales: {
            longCount: intOrNull(raw.longWhales),
            shortCount: intOrNull(raw.shortWhales),
            longQty: finite(raw.longWhalesQty),
            shortQty: finite(raw.shortWhalesQty),
            longAvgEntry: finite(raw.longWhalesAvgEntryPrice),
            shortAvgEntry: finite(raw.shortWhalesAvgEntryPrice),
            longProfitCount: intOrNull(raw.longProfitWhales),
            shortProfitCount: intOrNull(raw.shortProfitWhales),
        },
    };
}

async function fetchSmartMoneyOverview(symbol) {
    try {
        const { body } = await smartMoneyFetch("bapi", `${PATH}?symbol=${encodeURIComponent(symbol)}`, {
            usePeer: false,
            timeoutMs: 10_000,
        });
        if (body?.code === "000000" && body?.data) {
            const data = parseOverview(body.data);
            if (!data) return { ok: false, reason: "unsupported", data: null };
            const hasAny =
                data.traders.longQty != null ||
                data.traders.shortQty != null ||
                data.whales.longQty != null ||
                data.whales.shortQty != null ||
                data.traders.longCount != null ||
                data.traders.shortCount != null;
            if (!hasAny) return { ok: false, reason: "unsupported", data: null };
            return { ok: true, reason: null, data };
        }
        return { ok: false, reason: "unsupported", data: null };
    } catch (error) {
        if (error.code === "COOLDOWN" || error.code === "RATE_LIMIT") throw error;
        return { ok: false, reason: "source_error", error: String(error.message || error), data: null };
    }
}

module.exports = { fetchSmartMoneyOverview, parseOverview };
