const { smartMoneyFetch } = require("../http");
const { finite } = require("../formulas");

async function fetchOne(path, symbol, period) {
    const q = `${path}?symbol=${encodeURIComponent(symbol)}&period=${encodeURIComponent(period)}&limit=1`;
    const { body } = await smartMoneyFetch("futuresData", q);
    if (!Array.isArray(body) || !body.length) return null;
    // limit=1 → bucket mới nhất (với taker là bucket đã đóng gần nhất theo docs cộng đồng).
    return body[body.length - 1];
}

/**
 * Top trader account/position ratio + taker — độc lập; thiếu một nhánh không xóa các nhánh khác.
 */
async function fetchTopTraderBundle(symbol, period = "1h") {
    const out = {
        ok: false,
        reason: null,
        data: {
            period,
            accountLsr: null,
            accountLongPct: null,
            accountShortPct: null,
            positionLsr: null,
            positionLongPct: null,
            positionShortPct: null,
            takerBuySellRatio: null,
            takerBuyVol: null,
            takerSellVol: null,
            periodEnd: null,
            sourceUpdatedAt: null,
            partial: {},
        },
    };
    try {
        let acc = null;
        let pos = null;
        let taker = null;
        try {
            acc = await fetchOne("/futures/data/topLongShortAccountRatio", symbol, period);
        } catch (e) {
            if (e.code === "COOLDOWN" || e.code === "RATE_LIMIT") throw e;
            out.data.partial.account = "source_error";
        }
        try {
            pos = await fetchOne("/futures/data/topLongShortPositionRatio", symbol, period);
        } catch (e) {
            if (e.code === "COOLDOWN" || e.code === "RATE_LIMIT") throw e;
            out.data.partial.position = "source_error";
        }
        try {
            taker = await fetchOne("/futures/data/takerlongshortRatio", symbol, period);
        } catch (e) {
            if (e.code === "COOLDOWN" || e.code === "RATE_LIMIT") throw e;
            out.data.partial.taker = "source_error";
        }

        if (acc) {
            out.data.accountLongPct = finite(acc.longAccount);
            out.data.accountShortPct = finite(acc.shortAccount);
            out.data.accountLsr = finite(acc.longShortRatio);
            out.data.periodEnd = acc.timestamp ? new Date(Number(acc.timestamp)).toISOString() : out.data.periodEnd;
        }
        if (pos) {
            // Binance đặt tên longAccount/shortAccount nhưng nghĩa là position share.
            out.data.positionLongPct = finite(pos.longAccount);
            out.data.positionShortPct = finite(pos.shortAccount);
            out.data.positionLsr = finite(pos.longShortRatio);
            out.data.periodEnd = pos.timestamp ? new Date(Number(pos.timestamp)).toISOString() : out.data.periodEnd;
        }
        if (taker) {
            out.data.takerBuyVol = finite(taker.buyVol);
            out.data.takerSellVol = finite(taker.sellVol);
            out.data.takerBuySellRatio = finite(taker.buySellRatio);
            out.data.periodEnd = taker.timestamp ? new Date(Number(taker.timestamp)).toISOString() : out.data.periodEnd;
        }
        out.data.sourceUpdatedAt = out.data.periodEnd;
        out.ok = acc != null || pos != null || taker != null;
        if (!out.ok) out.reason = "unsupported";
        return out;
    } catch (error) {
        if (error.code === "COOLDOWN" || error.code === "RATE_LIMIT") throw error;
        return { ok: false, reason: "source_error", error: String(error.message || error), data: out.data };
    }
}

module.exports = { fetchTopTraderBundle };
