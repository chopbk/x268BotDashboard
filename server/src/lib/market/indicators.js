/**
 * Indicator thuần cho market-v1 — fixture độc lập, không gọi mạng.
 */
const { ema, atr, roundPrice } = require("../market-structure");

function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function sma(values, period) {
    if (!values || values.length < period) return null;
    let sum = 0;
    for (let i = values.length - period; i < values.length; i += 1) sum += values[i];
    return sum / period;
}

/** Chuỗi SMA kết thúc tại mỗi index (null khi chưa đủ period). */
function smaSeries(values, period) {
    const out = new Array(values.length).fill(null);
    if (!values || values.length < period) return out;
    let sum = 0;
    for (let i = 0; i < values.length; i += 1) {
        sum += values[i];
        if (i >= period) sum -= values[i - period];
        if (i >= period - 1) out[i] = sum / period;
    }
    return out;
}

function emaSeries(values, period) {
    const out = new Array(values.length).fill(null);
    if (!values || values.length < period) return out;
    const k = 2 / (period + 1);
    let value = 0;
    for (let i = 0; i < period; i += 1) value += values[i];
    value /= period;
    out[period - 1] = value;
    for (let i = period; i < values.length; i += 1) {
        value = values[i] * k + value * (1 - k);
        out[i] = value;
    }
    return out;
}

/** RSI Wilder — trả giá trị tại nến cuối và series. */
function rsiSeries(closes, period = 14) {
    const out = new Array(closes.length).fill(null);
    if (!closes || closes.length < period + 1) return { series: out, last: null };
    let gains = 0;
    let losses = 0;
    for (let i = 1; i <= period; i += 1) {
        const d = closes[i] - closes[i - 1];
        if (d >= 0) gains += d;
        else losses -= d;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    const first = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    out[period] = first;
    for (let i = period + 1; i < closes.length; i += 1) {
        const d = closes[i] - closes[i - 1];
        const gain = d > 0 ? d : 0;
        const loss = d < 0 ? -d : 0;
        avgGain = (avgGain * (period - 1) + gain) / period;
        avgLoss = (avgLoss * (period - 1) + loss) / period;
        out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
    const last = out[out.length - 1];
    return { series: out, last: last == null ? null : roundPrice(last, 2) };
}

function macdSeries(closes, fast = 12, slow = 26, signalPeriod = 9) {
    const empty = { macd: null, signal: null, hist: null, macdLine: [], signalLine: [], histLine: [] };
    if (!closes || closes.length < slow + signalPeriod) return empty;
    const fastE = emaSeries(closes, fast);
    const slowE = emaSeries(closes, slow);
    const macdLine = closes.map((_, i) =>
        fastE[i] != null && slowE[i] != null ? fastE[i] - slowE[i] : null
    );
    const firstValid = macdLine.findIndex((v) => v != null);
    const macdCompact = macdLine.slice(firstValid);
    const signalCompact = emaSeries(macdCompact, signalPeriod);
    const signalLine = new Array(closes.length).fill(null);
    const histLine = new Array(closes.length).fill(null);
    for (let i = 0; i < signalCompact.length; i += 1) {
        const idx = firstValid + i;
        signalLine[idx] = signalCompact[i];
        if (macdLine[idx] != null && signalCompact[i] != null) {
            histLine[idx] = macdLine[idx] - signalCompact[i];
        }
    }
    const last = closes.length - 1;
    return {
        macd: macdLine[last] == null ? null : roundPrice(macdLine[last], 6),
        signal: signalLine[last] == null ? null : roundPrice(signalLine[last], 6),
        hist: histLine[last] == null ? null : roundPrice(histLine[last], 6),
        macdLine,
        signalLine,
        histLine,
    };
}

/** True Range series (length = candles.length, index 0 = null). */
function trSeries(candles) {
    const out = new Array(candles.length).fill(null);
    for (let i = 1; i < candles.length; i += 1) {
        const cur = candles[i];
        const prev = candles[i - 1];
        out[i] = Math.max(
            cur.high - cur.low,
            Math.abs(cur.high - prev.close),
            Math.abs(cur.low - prev.close)
        );
    }
    return out;
}

function rmaSeries(values, period) {
    const out = new Array(values.length).fill(null);
    let seed = 0;
    let count = 0;
    let rma = null;
    for (let i = 0; i < values.length; i += 1) {
        const v = values[i];
        if (v == null) continue;
        if (rma == null) {
            seed += v;
            count += 1;
            if (count === period) {
                rma = seed / period;
                out[i] = rma;
            }
        } else {
            rma = (rma * (period - 1) + v) / period;
            out[i] = rma;
        }
    }
    return out;
}

function adxSeries(candles, period = 14) {
    const empty = { adx: null, plusDI: null, minusDI: null, series: [] };
    if (!candles || candles.length < period * 2) return empty;
    const plusDM = new Array(candles.length).fill(null);
    const minusDM = new Array(candles.length).fill(null);
    const tr = trSeries(candles);
    for (let i = 1; i < candles.length; i += 1) {
        const up = candles[i].high - candles[i - 1].high;
        const down = candles[i - 1].low - candles[i].low;
        plusDM[i] = up > down && up > 0 ? up : 0;
        minusDM[i] = down > up && down > 0 ? down : 0;
    }
    const atrR = rmaSeries(tr, period);
    const plusR = rmaSeries(plusDM, period);
    const minusR = rmaSeries(minusDM, period);
    const dx = new Array(candles.length).fill(null);
    for (let i = 0; i < candles.length; i += 1) {
        if (atrR[i] == null || atrR[i] === 0 || plusR[i] == null || minusR[i] == null) continue;
        const pdi = (100 * plusR[i]) / atrR[i];
        const mdi = (100 * minusR[i]) / atrR[i];
        const sum = pdi + mdi;
        dx[i] = sum === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / sum;
    }
    const adx = rmaSeries(dx, period);
    const last = candles.length - 1;
    const pdiLast = atrR[last] ? (100 * plusR[last]) / atrR[last] : null;
    const mdiLast = atrR[last] ? (100 * minusR[last]) / atrR[last] : null;
    return {
        adx: adx[last] == null ? null : roundPrice(adx[last], 2),
        plusDI: pdiLast == null ? null : roundPrice(pdiLast, 2),
        minusDI: mdiLast == null ? null : roundPrice(mdiLast, 2),
        series: adx,
    };
}

/** Bollinger: σ population / n. */
function bollingerSeries(closes, period = 20, mult = 2) {
    const mid = smaSeries(closes, period);
    const upper = new Array(closes.length).fill(null);
    const lower = new Array(closes.length).fill(null);
    const bandwidth = new Array(closes.length).fill(null);
    for (let i = period - 1; i < closes.length; i += 1) {
        const mean = mid[i];
        if (mean == null) continue;
        let sumSq = 0;
        for (let j = i - period + 1; j <= i; j += 1) {
            const d = closes[j] - mean;
            sumSq += d * d;
        }
        const sd = Math.sqrt(sumSq / period);
        upper[i] = mean + mult * sd;
        lower[i] = mean - mult * sd;
        if (mean !== 0) bandwidth[i] = (upper[i] - lower[i]) / mean;
    }
    const last = closes.length - 1;
    return {
        middle: mid[last] == null ? null : roundPrice(mid[last]),
        upper: upper[last] == null ? null : roundPrice(upper[last]),
        lower: lower[last] == null ? null : roundPrice(lower[last]),
        bandwidth: bandwidth[last] == null ? null : roundPrice(bandwidth[last], 4),
        middleSeries: mid,
        upperSeries: upper,
        lowerSeries: lower,
        bandwidthSeries: bandwidth,
    };
}

/**
 * Supertrend ATR10 × 3.
 * @returns {{ direction: 'up'|'down'|null, value: number|null, series: Array }}
 */
function supertrendSeries(candles, period = 10, multiplier = 3) {
    const empty = { direction: null, value: null, series: [] };
    if (!candles || candles.length < period + 2) return empty;
    const atrVals = [];
    const tr = trSeries(candles);
    // ATR Wilder series aligned to candles
    const atrR = rmaSeries(tr, period);
    const series = new Array(candles.length).fill(null);
    let finalUpper = null;
    let finalLower = null;
    let direction = null;
    for (let i = 0; i < candles.length; i += 1) {
        if (atrR[i] == null) continue;
        const hl2 = (candles[i].high + candles[i].low) / 2;
        let basicUpper = hl2 + multiplier * atrR[i];
        let basicLower = hl2 - multiplier * atrR[i];
        if (finalUpper == null) {
            finalUpper = basicUpper;
            finalLower = basicLower;
            direction = candles[i].close >= hl2 ? "up" : "down";
        } else {
            finalLower =
                basicLower > finalLower || candles[i - 1].close < finalLower
                    ? basicLower
                    : finalLower;
            finalUpper =
                basicUpper < finalUpper || candles[i - 1].close > finalUpper
                    ? basicUpper
                    : finalUpper;
            if (direction === "up") {
                if (candles[i].close < finalLower) direction = "down";
            } else if (candles[i].close > finalUpper) direction = "up";
        }
        const value = direction === "up" ? finalLower : finalUpper;
        series[i] = { direction, value };
        atrVals.push(atrR[i]);
    }
    const last = series[series.length - 1];
    return {
        direction: last?.direction || null,
        value: last?.value == null ? null : roundPrice(last.value),
        series,
    };
}

function relativeVolumeAt(candles, index, lookback = 20) {
    if (index < lookback) return null;
    let sum = 0;
    for (let i = index - lookback; i < index; i += 1) sum += candles[i].volume || 0;
    const avg = sum / lookback;
    if (!(avg > 0)) return null;
    return roundPrice((candles[index].volume || 0) / avg, 2);
}

/**
 * Tính bộ indicator trên nến đã đóng (không gồm forming).
 */
function computeIndicators(closedCandles) {
    if (!closedCandles?.length) return null;
    const closes = closedCandles.map((c) => c.close);
    const ema20 = ema(closes, 20);
    const ema50 = ema(closes, 50);
    const atr14 = atr(closedCandles, 14);
    const rsi = rsiSeries(closes, 14);
    const macd = macdSeries(closes, 12, 26, 9);
    const adx = adxSeries(closedCandles, 14);
    const bb = bollingerSeries(closes, 20, 2);
    const st = supertrendSeries(closedCandles, 10, 3);
    const lastIdx = closedCandles.length - 1;
    const last = closedCandles[lastIdx];
    const relVol = relativeVolumeAt(closedCandles, lastIdx, 20);

    // Squeeze: bandwidth < 0.6 * avg 20 prior bandwidths
    let squeeze = false;
    let squeezeBreakout = null;
    const bw = bb.bandwidthSeries;
    if (lastIdx >= 21 && bw[lastIdx] != null) {
        let sum = 0;
        let n = 0;
        for (let i = lastIdx - 20; i < lastIdx; i += 1) {
            if (bw[i] != null) {
                sum += bw[i];
                n += 1;
            }
        }
        if (n === 20) {
            const avg = sum / 20;
            // Tìm nến gần nhất còn trong/ vừa thoát squeeze trong 3 nến
            for (let look = 0; look <= 3; look += 1) {
                const idx = lastIdx - look;
                if (idx < 21) break;
                let priorSum = 0;
                let priorN = 0;
                for (let i = idx - 20; i < idx; i += 1) {
                    if (bw[i] != null) {
                        priorSum += bw[i];
                        priorN += 1;
                    }
                }
                if (priorN < 20 || bw[idx] == null) continue;
                const priorAvg = priorSum / 20;
                const wasSqueeze = bw[idx] < 0.6 * priorAvg;
                if (look === 0) squeeze = wasSqueeze;
                if (!wasSqueeze && look > 0) {
                    // Kiểm tra có nến squeeze ngay trước cửa sổ 3 nến
                    const prev = idx - 1;
                    if (prev >= 21 && bw[prev] != null) {
                        let pSum = 0;
                        let pN = 0;
                        for (let i = prev - 20; i < prev; i += 1) {
                            if (bw[i] != null) {
                                pSum += bw[i];
                                pN += 1;
                            }
                        }
                        if (pN === 20 && bw[prev] < 0.6 * (pSum / 20)) {
                            if (closes[idx] >= bb.upperSeries[idx]) squeezeBreakout = "long";
                            else if (closes[idx] <= bb.lowerSeries[idx]) squeezeBreakout = "short";
                        }
                    }
                    break;
                }
            }
            // Breakout trên nến hiện tại nếu vừa thoát
            if (!squeeze && lastIdx >= 22) {
                const prev = lastIdx - 1;
                let pSum = 0;
                let pN = 0;
                for (let i = prev - 20; i < prev; i += 1) {
                    if (bw[i] != null) {
                        pSum += bw[i];
                        pN += 1;
                    }
                }
                if (pN === 20 && bw[prev] != null && bw[prev] < 0.6 * (pSum / 20)) {
                    if (last.close >= bb.upper) squeezeBreakout = "long";
                    else if (last.close <= bb.lower) squeezeBreakout = "short";
                }
            }
            void avg;
        }
    }

    return {
        lastClose: roundPrice(last.close),
        lastOpen: roundPrice(last.open),
        ema20: ema20 == null ? null : roundPrice(ema20),
        ema50: ema50 == null ? null : roundPrice(ema50),
        atr14: atr14 == null ? null : roundPrice(atr14),
        rsi14: rsi.last,
        rsiSeries: rsi.series,
        macd,
        adx: adx.adx,
        plusDI: adx.plusDI,
        minusDI: adx.minusDI,
        bb,
        supertrend: st,
        relativeVolume: relVol,
        squeeze,
        squeezeBreakout,
        closedBars: closedCandles.length,
        candle: last,
    };
}

module.exports = {
    sma,
    smaSeries,
    emaSeries,
    rsiSeries,
    macdSeries,
    adxSeries,
    bollingerSeries,
    supertrendSeries,
    relativeVolumeAt,
    computeIndicators,
    num,
};
