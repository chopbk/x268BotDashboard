/**
 * Regime classifier BTC — docs/market.md
 * Trend Up / Trend Down / Squeeze / Range / Expansion
 */
const { computeDashIndicators } = require("./indicators");

/**
 * @param {object} ind — output computeDashIndicators
 * @returns {{ regime: string, reasons: string[] }}
 */
function classifyRegime(ind) {
    if (!ind) return { regime: "unknown", reasons: ["Thiếu dữ liệu nến"] };
    const reasons = [];
    const price = ind.lastClose;
    const { ema20, ema50, ema200, adx, atr14, bb, squeeze } = ind;

    // Expansion: BB width tăng > 30% trong 5 nến + volume > 1.5× MA20
    const bw = bb?.bandwidthSeries;
    const lastIdx = bw ? bw.length - 1 : -1;
    if (lastIdx >= 5 && bw[lastIdx] != null && bw[lastIdx - 5] != null && bw[lastIdx - 5] > 0) {
        const growth = (bw[lastIdx] - bw[lastIdx - 5]) / bw[lastIdx - 5];
        if (growth > 0.3 && ind.relativeVolume != null && ind.relativeVolume >= 1.5) {
            reasons.push(
                `BB width +${(growth * 100).toFixed(0)}% /5 nến, vol ${ind.relativeVolume}× MA20`
            );
            return { regime: "expansion", reasons };
        }
    }

    // Squeeze: BB width ≤ p20 của 120 nến, ADX < 18
    if (squeeze?.inSqueeze && adx != null && adx < 18) {
        reasons.push(`BB width ≤ p20 (streak ${squeeze.streak}), ADX ${adx}`);
        return { regime: "squeeze", reasons };
    }

    // Trend Up / Down
    if (
        ema20 != null &&
        ema50 != null &&
        ema200 != null &&
        adx != null &&
        adx > 22 &&
        price != null
    ) {
        if (ema20 > ema50 && ema50 > ema200 && price > ema50) {
            reasons.push(`EMA20>50>200, ADX ${adx}, giá > EMA50`);
            return { regime: "trend_up", reasons };
        }
        if (ema20 < ema50 && ema50 < ema200 && price < ema50) {
            reasons.push(`EMA20<50<200, ADX ${adx}, giá < EMA50`);
            return { regime: "trend_down", reasons };
        }
    }

    // Range: ADX < 20, giá trong ±1.5×ATR quanh EMA50, BB width bình thường
    if (adx != null && adx < 20 && ema50 != null && atr14 != null && price != null) {
        const band = 1.5 * atr14;
        if (Math.abs(price - ema50) <= band) {
            reasons.push(`ADX ${adx}, giá trong ±1.5 ATR quanh EMA50`);
            return { regime: "range", reasons };
        }
    }

    // Fallback soft
    if (ema20 != null && ema50 != null && price != null) {
        if (ema20 > ema50 && price > ema50) {
            reasons.push("EMA20>EMA50 nhưng chưa đủ ADX/stack → nghiêng tăng nhẹ");
            return { regime: "trend_up", reasons };
        }
        if (ema20 < ema50 && price < ema50) {
            reasons.push("EMA20<EMA50 nhưng chưa đủ ADX/stack → nghiêng giảm nhẹ");
            return { regime: "trend_down", reasons };
        }
    }

    reasons.push("Không khớp điều kiện rõ — coi như Range");
    return { regime: "range", reasons };
}

function regimeLabelVi(regime) {
    const map = {
        trend_up: "Trend Up",
        trend_down: "Trend Down",
        squeeze: "Squeeze",
        range: "Range",
        expansion: "Expansion",
        unknown: "Chưa rõ",
    };
    return map[regime] || regime;
}

function classifyFromCandles(closedCandles) {
    const ind = computeDashIndicators(closedCandles);
    const result = classifyRegime(ind);
    return { ...result, label: regimeLabelVi(result.regime), indicators: ind };
}

module.exports = {
    classifyRegime,
    classifyFromCandles,
    regimeLabelVi,
};
