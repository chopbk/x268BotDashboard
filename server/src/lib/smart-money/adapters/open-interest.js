const { smartMoneyFetch } = require("../http");
const { finite } = require("../formulas");

/**
 * Ưu tiên openInterestHist (bucket riêng) — lấy limit nhỏ để tính delta gần.
 */
async function fetchOpenInterest(symbol, period = "5m", limit = 12) {
    const sym = encodeURIComponent(symbol);
    const q = `/futures/data/openInterestHist?symbol=${sym}&period=${encodeURIComponent(period)}&limit=${limit}`;
    try {
        const { body } = await smartMoneyFetch("futuresData", q);
        if (!Array.isArray(body) || !body.length) {
            return { ok: false, reason: "unsupported", data: null };
        }
        const sorted = [...body].sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
        const last = sorted[sorted.length - 1];
        const prev = sorted.length > 1 ? sorted[sorted.length - 2] : null;
        return {
            ok: true,
            reason: null,
            data: {
                qty: finite(last.sumOpenInterest),
                notional: finite(last.sumOpenInterestValue),
                sourceUpdatedAt: last.timestamp ? new Date(Number(last.timestamp)).toISOString() : null,
                periodStart: sorted[0]?.timestamp ? new Date(Number(sorted[0].timestamp)).toISOString() : null,
                periodEnd: last.timestamp ? new Date(Number(last.timestamp)).toISOString() : null,
                prevQty: prev ? finite(prev.sumOpenInterest) : null,
                prevNotional: prev ? finite(prev.sumOpenInterestValue) : null,
                series: sorted.map((r) => ({
                    t: Number(r.timestamp),
                    qty: finite(r.sumOpenInterest),
                    notional: finite(r.sumOpenInterestValue),
                })),
            },
        };
    } catch (error) {
        if (error.code === "COOLDOWN" || error.code === "RATE_LIMIT") throw error;
        return { ok: false, reason: "source_error", error: String(error.message || error), data: null };
    }
}

module.exports = { fetchOpenInterest };
