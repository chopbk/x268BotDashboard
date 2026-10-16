/**
 * Pivot / divergence / SMC tối giản cho market-v1.
 * Tham số: docs/market-formula-v1.md
 */
const { findSwings, roundPrice } = require("../market-structure");

const PIVOT_LEFT = 2;
const PIVOT_RIGHT = 2;
const MIN_PIVOT_GAP = 5;
const MAX_PIVOT_AGE = 40;
const ZONE_EXPIRY_BARS = 50;
const RETEST_ATR_BUF = 0.15;

function filterRecent(pivots, lastIndex, maxAge = MAX_PIVOT_AGE, minGap = MIN_PIVOT_GAP) {
    const recent = pivots.filter((p) => lastIndex - p.index <= maxAge && lastIndex - p.index >= PIVOT_RIGHT);
    const out = [];
    for (const p of recent) {
        const prev = out[out.length - 1];
        if (prev && p.index - prev.index < minGap) {
            // Giữ pivot cực hơn cùng hướng tuổi gần hơn
            out[out.length - 1] = p;
        } else {
            out.push(p);
        }
    }
    return out;
}

function detectDivergence(candles, rsiSeries) {
    const lastIndex = candles.length - 1;
    const { highs, lows } = findSwings(candles, PIVOT_LEFT);
    const hi = filterRecent(highs, lastIndex);
    const lo = filterRecent(lows, lastIndex);
    let bullish = null;
    let bearish = null;

    if (lo.length >= 2) {
        const a = lo[lo.length - 2];
        const b = lo[lo.length - 1];
        const rsiA = rsiSeries[a.index];
        const rsiB = rsiSeries[b.index];
        if (rsiA != null && rsiB != null && b.price < a.price && rsiB > rsiA) {
            bullish = {
                type: "bullish_divergence",
                pivots: [a, b],
                confirmedAt: candles[b.index + PIVOT_RIGHT]?.openTime ?? candles[b.index].openTime,
                explanation: `Giá LL ${roundPrice(b.price)} vs ${roundPrice(a.price)}, RSI HL`,
            };
        }
    }
    if (hi.length >= 2) {
        const a = hi[hi.length - 2];
        const b = hi[hi.length - 1];
        const rsiA = rsiSeries[a.index];
        const rsiB = rsiSeries[b.index];
        if (rsiA != null && rsiB != null && b.price > a.price && rsiB < rsiA) {
            bearish = {
                type: "bearish_divergence",
                pivots: [a, b],
                confirmedAt: candles[b.index + PIVOT_RIGHT]?.openTime ?? candles[b.index].openTime,
                explanation: `Giá HH ${roundPrice(b.price)} vs ${roundPrice(a.price)}, RSI LH`,
            };
        }
    }
    return { bullish, bearish, highs: hi, lows: lo };
}

/**
 * Phân tích cấu trúc SMC trên nến đóng cuối.
 * @param {Array} candles
 * @param {{ atr14?: number|null, rsiSeries?: number[] }} opts
 */
function analyzeSmc(candles, opts = {}) {
    if (!candles || candles.length < 30) {
        return { evidence: [], structureBias: "unknown", divergence: {} };
    }
    const lastIndex = candles.length - 1;
    const last = candles[lastIndex];
    const atr14 = opts.atr14;
    const buf = atr14 != null ? RETEST_ATR_BUF * atr14 : 0;
    const rsiSeries = opts.rsiSeries || [];
    const divergence = detectDivergence(candles, rsiSeries);
    const highs = divergence.highs;
    const lows = divergence.lows;
    const evidence = [];

    const lastHigh = highs[highs.length - 1];
    const lastLow = lows[lows.length - 1];

    // Sweep: wick vượt swing, close quay lại trong
    if (lastHigh && lastIndex - lastHigh.index <= MAX_PIVOT_AGE) {
        if (last.high > lastHigh.price + buf && last.close < lastHigh.price) {
            evidence.push({
                id: "sweep_high",
                side: "short",
                points: 2,
                maxPoints: 2,
                type: "sweep",
                evidenceTime: last.closeTime || last.openTime,
                explanation: `Wick quét swing high ${roundPrice(lastHigh.price)}, close quay lại`,
            });
        }
    }
    if (lastLow && lastIndex - lastLow.index <= MAX_PIVOT_AGE) {
        if (last.low < lastLow.price - buf && last.close > lastLow.price) {
            evidence.push({
                id: "sweep_low",
                side: "long",
                points: 2,
                maxPoints: 2,
                type: "sweep",
                evidenceTime: last.closeTime || last.openTime,
                explanation: `Wick quét swing low ${roundPrice(lastLow.price)}, close quay lại`,
            });
        }
    }

    // BOS: close vượt swing
    if (lastHigh && last.close > lastHigh.price + buf && lastIndex > lastHigh.index) {
        evidence.push({
            id: "bos_bull",
            side: "long",
            points: 1.5,
            maxPoints: 2,
            type: "bos",
            evidenceTime: last.closeTime || last.openTime,
            explanation: `Close phá swing high ${roundPrice(lastHigh.price)}`,
            swingIndex: lastHigh.index,
        });
    }
    if (lastLow && last.close < lastLow.price - buf && lastIndex > lastLow.index) {
        evidence.push({
            id: "bos_bear",
            side: "short",
            points: 1.5,
            maxPoints: 2,
            type: "bos",
            evidenceTime: last.closeTime || last.openTime,
            explanation: `Close phá swing low ${roundPrice(lastLow.price)}`,
            swingIndex: lastLow.index,
        });
    }

    // OB + FVG đơn giản quanh BOS gần nhất
    const bullBos = evidence.find((e) => e.id === "bos_bull");
    const bearBos = evidence.find((e) => e.id === "bos_bear");
    if (bullBos && bullBos.swingIndex != null) {
        const obIdx = Math.max(0, bullBos.swingIndex - 1);
        const ob = candles[obIdx];
        const zoneLow = Math.min(ob.open, ob.close) - buf;
        const zoneHigh = Math.max(ob.open, ob.close) + buf;
        const age = lastIndex - obIdx;
        const invalidated = candles.slice(obIdx + 1).some((c) => c.close < zoneLow);
        if (!invalidated && age <= ZONE_EXPIRY_BARS && last.low <= zoneHigh && last.low >= zoneLow - buf) {
            evidence.push({
                id: "ob_retest_long",
                side: "long",
                points: 1,
                maxPoints: 2,
                type: "ob_retest",
                evidenceTime: last.closeTime || last.openTime,
                explanation: `Retest OB tăng [${roundPrice(zoneLow)}–${roundPrice(zoneHigh)}]`,
            });
        }
    }
    if (bearBos && bearBos.swingIndex != null) {
        const obIdx = Math.max(0, bearBos.swingIndex - 1);
        const ob = candles[obIdx];
        const zoneLow = Math.min(ob.open, ob.close) - buf;
        const zoneHigh = Math.max(ob.open, ob.close) + buf;
        const age = lastIndex - obIdx;
        const invalidated = candles.slice(obIdx + 1).some((c) => c.close > zoneHigh);
        if (!invalidated && age <= ZONE_EXPIRY_BARS && last.high >= zoneLow && last.high <= zoneHigh + buf) {
            evidence.push({
                id: "ob_retest_short",
                side: "short",
                points: 1,
                maxPoints: 2,
                type: "ob_retest",
                evidenceTime: last.closeTime || last.openTime,
                explanation: `Retest OB giảm [${roundPrice(zoneLow)}–${roundPrice(zoneHigh)}]`,
            });
        }
    }

    // FVG 3-candle
    for (let i = Math.max(2, lastIndex - 8); i <= lastIndex; i += 1) {
        const a = candles[i - 2];
        const c = candles[i];
        if (c.low > a.high) {
            const age = lastIndex - i;
            const mitigated = candles.slice(i + 1).some((x) => x.low <= a.high);
            if (!mitigated && age <= ZONE_EXPIRY_BARS && last.low <= c.low && last.low >= a.high - buf) {
                evidence.push({
                    id: "fvg_retest_long",
                    side: "long",
                    points: 0.5,
                    maxPoints: 2,
                    type: "fvg_retest",
                    evidenceTime: last.closeTime || last.openTime,
                    explanation: `Retest FVG tăng ${roundPrice(a.high)}–${roundPrice(c.low)}`,
                });
            }
        }
        if (c.high < a.low) {
            const age = lastIndex - i;
            const mitigated = candles.slice(i + 1).some((x) => x.high >= a.low);
            if (!mitigated && age <= ZONE_EXPIRY_BARS && last.high >= c.high && last.high <= a.low + buf) {
                evidence.push({
                    id: "fvg_retest_short",
                    side: "short",
                    points: 0.5,
                    maxPoints: 2,
                    type: "fvg_retest",
                    evidenceTime: last.closeTime || last.openTime,
                    explanation: `Retest FVG giảm ${roundPrice(c.high)}–${roundPrice(a.low)}`,
                });
            }
        }
    }

    let structureBias = "unknown";
    if (highs.length >= 2 && lows.length >= 2) {
        const hh = highs[highs.length - 1].price > highs[highs.length - 2].price;
        const hl = lows[lows.length - 1].price > lows[lows.length - 2].price;
        const lh = highs[highs.length - 1].price < highs[highs.length - 2].price;
        const ll = lows[lows.length - 1].price < lows[lows.length - 2].price;
        if (hh && hl) structureBias = "bullish";
        else if (lh && ll) structureBias = "bearish";
        else if (hh && ll) structureBias = "expanding";
        else if (lh && hl) structureBias = "contracting";
        else structureBias = "mixed";
    }

    return { evidence, structureBias, divergence, highs, lows };
}

/** Chọn bằng chứng SMC mạnh nhất cho một side, trần 2 điểm. */
function pickSmcPoints(evidence, side) {
    const candidates = evidence.filter((e) => e.side === side);
    if (!candidates.length) {
        return {
            points: 0,
            rule: {
                id: "smc",
                side,
                value: null,
                condition: "Không có sweep/BOS/OB/FVG hiệu lực",
                points: 0,
                maxPoints: 2,
                evidenceTime: null,
                explanation: "Không có bằng chứng SMC",
            },
        };
    }
    candidates.sort((a, b) => b.points - a.points);
    const best = candidates[0];
    const points = Math.min(2, best.points);
    return {
        points,
        rule: {
            id: "smc",
            side,
            value: best.type,
            condition: best.explanation,
            points,
            maxPoints: 2,
            evidenceTime: best.evidenceTime,
            explanation: best.explanation,
        },
    };
}

module.exports = {
    PIVOT_LEFT,
    PIVOT_RIGHT,
    MIN_PIVOT_GAP,
    MAX_PIVOT_AGE,
    analyzeSmc,
    pickSmcPoints,
    detectDivergence,
};
