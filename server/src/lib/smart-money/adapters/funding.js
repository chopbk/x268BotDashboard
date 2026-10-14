const { smartMoneyFetch } = require("../http");
const { finite } = require("../formulas");

async function fetchFunding(symbol) {
    const sym = encodeURIComponent(symbol);
    try {
        const { body: premium } = await smartMoneyFetch("fapi", `/fapi/v1/premiumIndex?symbol=${sym}`);
        const currentRate = finite(premium?.lastFundingRate);
        const markPrice = finite(premium?.markPrice);
        const nextFundingTime = premium?.nextFundingTime ? Number(premium.nextFundingTime) : null;
        let lastSettledRate = null;
        let lastSettledAt = null;
        let intervalHours = null;
        try {
            const { body: hist } = await smartMoneyFetch(
                "fapi",
                `/fapi/v1/fundingRate?symbol=${sym}&limit=2`
            );
            if (Array.isArray(hist) && hist.length) {
                const sorted = [...hist].sort((a, b) => Number(a.fundingTime) - Number(b.fundingTime));
                const last = sorted[sorted.length - 1];
                lastSettledRate = finite(last.fundingRate);
                lastSettledAt = last.fundingTime ? new Date(Number(last.fundingTime)).toISOString() : null;
                if (sorted.length >= 2) {
                    const dt = Number(sorted[sorted.length - 1].fundingTime) - Number(sorted[sorted.length - 2].fundingTime);
                    if (dt > 0) intervalHours = Math.round((dt / 3_600_000) * 10) / 10;
                }
            }
        } catch (inner) {
            if (inner.code === "COOLDOWN" || inner.code === "RATE_LIMIT") throw inner;
            // giữ current; lastSettled null
        }
        return {
            ok: true,
            reason: null,
            data: {
                currentRate,
                lastSettledRate,
                lastSettledAt,
                nextFundingTime: nextFundingTime ? new Date(nextFundingTime).toISOString() : null,
                markPrice,
                intervalHours,
                sourceUpdatedAt: new Date().toISOString(),
            },
        };
    } catch (error) {
        if (error.code === "COOLDOWN" || error.code === "RATE_LIMIT") throw error;
        return { ok: false, reason: "source_error", error: String(error.message || error), data: null };
    }
}

module.exports = { fetchFunding };
