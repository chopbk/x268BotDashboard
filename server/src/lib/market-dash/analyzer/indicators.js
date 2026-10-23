/**
 * Indicator helpers cho Market Dashboard — thuần, fixture-testable.
 * Tái dùng primitives từ market/indicators + market-structure.
 */
const { ema, atr, roundPrice } = require("../../market-structure");
const {
    emaSeries,
    smaSeries,
    rsiSeries,
    adxSeries,
    bollingerSeries,
    relativeVolumeAt,
} = require("../../market/indicators");
const { percentileOf } = require("../store");

function donchianSeries(candles, period = 20) {
    const upper = new Array(candles.length).fill(null);
    const lower = new Array(candles.length).fill(null);
    const mid = new Array(candles.length).fill(null);
    for (let i = period - 1; i < candles.length; i += 1) {
        let hi = -Infinity;
        let lo = Infinity;
        for (let j = i - period + 1; j <= i; j += 1) {
            hi = Math.max(hi, candles[j].high);
            lo = Math.min(lo, candles[j].low);
        }
        upper[i] = hi;
        lower[i] = lo;
        mid[i] = (hi + lo) / 2;
    }
    const last = candles.length - 1;
    return {
        upper: upper[last],
        lower: lower[last],
        mid: mid[last],
        upperSeries: upper,
        lowerSeries: lower,
        midSeries: mid,
    };
}

/** Percentile của value trong mảng (0–100). */
function percentileRank(values, value) {
    return percentileOf(values, value);
}

/** Giá trị tại percentile p (0–100) của mảng. */
function valueAtPercentile(values, p) {
    const sorted = [...(values || [])].filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * (sorted.length - 1))));
    return sorted[idx];
}

/**
 * Số nến liên tiếp (kết thúc tại endIdx) có BB width <= p20 của lookback cửa sổ.
 */
function squeezeStreak(bandwidthSeries, endIdx, lookback = 120, p = 20) {
    if (endIdx < lookback - 1) return { streak: 0, p20: null, inSqueeze: false };
    const window = [];
    for (let i = endIdx - lookback + 1; i <= endIdx; i += 1) {
        if (bandwidthSeries[i] != null) window.push(bandwidthSeries[i]);
    }
    const p20 = valueAtPercentile(window, p);
    if (p20 == null) return { streak: 0, p20: null, inSqueeze: false };
    let streak = 0;
    for (let i = endIdx; i >= 0; i -= 1) {
        if (bandwidthSeries[i] == null) break;
        if (bandwidthSeries[i] <= p20) streak += 1;
        else break;
    }
    return {
        streak,
        p20,
        inSqueeze: bandwidthSeries[endIdx] != null && bandwidthSeries[endIdx] <= p20,
    };
}

/** ATR đang mở rộng: ATR hiện > ATR trung bình N nến trước. */
function atrExpanding(candles, period = 14, lookback = 5) {
    if (!candles || candles.length < period + lookback + 2) return false;
    const atrSeries = [];
    for (let i = period + 1; i <= candles.length; i += 1) {
        const slice = candles.slice(0, i);
        const v = atr(slice, period);
        atrSeries.push(v);
    }
    const last = atrSeries[atrSeries.length - 1];
    if (last == null) return false;
    const prior = atrSeries.slice(-(lookback + 1), -1).filter((v) => v != null);
    if (prior.length < lookback) return false;
    const avg = prior.reduce((a, b) => a + b, 0) / prior.length;
    return last > avg;
}

function computeDashIndicators(closedCandles) {
    if (!closedCandles?.length) return null;
    const closes = closedCandles.map((c) => c.close);
    const lastIdx = closedCandles.length - 1;
    const last = closedCandles[lastIdx];
    const e20 = ema(closes, 20);
    const e50 = ema(closes, 50);
    const e200 = ema(closes, 200);
    const e20s = emaSeries(closes, 20);
    const e50s = emaSeries(closes, 50);
    const e200s = emaSeries(closes, 200);
    const rsi = rsiSeries(closes, 14);
    const adx = adxSeries(closedCandles, 14);
    const bb = bollingerSeries(closes, 20, 2);
    const don = donchianSeries(closedCandles, 20);
    const atr14 = atr(closedCandles, 14);
    const relVol = relativeVolumeAt(closedCandles, lastIdx, 20);
    const sq = squeezeStreak(bb.bandwidthSeries, lastIdx, 120, 20);
    const volMa20 = smaSeries(
        closedCandles.map((c) => c.volume || 0),
        20
    );

    return {
        lastClose: roundPrice(last.close),
        lastHigh: roundPrice(last.high),
        lastLow: roundPrice(last.low),
        lastOpen: roundPrice(last.open),
        lastVolume: last.volume,
        candle: last,
        candleCloseTime: last.closeTime,
        ema20: e20 == null ? null : roundPrice(e20),
        ema50: e50 == null ? null : roundPrice(e50),
        ema200: e200 == null ? null : roundPrice(e200),
        ema20Series: e20s,
        ema50Series: e50s,
        ema200Series: e200s,
        rsi14: rsi.last,
        rsiSeries: rsi.series,
        adx: adx.adx,
        plusDI: adx.plusDI,
        minusDI: adx.minusDI,
        bb,
        donchian: don,
        atr14: atr14 == null ? null : roundPrice(atr14),
        relativeVolume: relVol,
        volumeMa20: volMa20[lastIdx],
        squeeze: sq,
        atrExpanding: atrExpanding(closedCandles, 14, 5),
        closedBars: closedCandles.length,
    };
}

module.exports = {
    donchianSeries,
    percentileRank,
    valueAtPercentile,
    squeezeStreak,
    atrExpanding,
    computeDashIndicators,
    ema,
    atr,
    emaSeries,
    rsiSeries,
    adxSeries,
    bollingerSeries,
    roundPrice,
};
