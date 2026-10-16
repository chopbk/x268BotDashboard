/**
 * Scoring Long/Short độc lập cho một timeframe — market-v1.
 */
const { FORMULA_VERSION, INTERVAL_MS, STALE_FACTOR, config } = require("./config");
const { computeIndicators } = require("./indicators");
const { analyzeSmc, pickSmcPoints } = require("./smc-structure");
const MAX_RAW = 13;

function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
}

function round1(n) {
    return Number(Number(n).toFixed(1));
}

function round2(n) {
    return Number(Number(n).toFixed(2));
}

function normalizeScore(raw) {
    if (raw == null || !Number.isFinite(raw)) return null;
    return round1(clamp((raw / MAX_RAW) * 100, 0, 100));
}

function rule(id, side, value, condition, points, maxPoints, evidenceTime, explanation) {
    return { id, side, value, condition, points, maxPoints, evidenceTime, explanation };
}

function regimeOf(ind) {
    const adx = ind.adx;
    const ema20 = ind.ema20;
    const ema50 = ind.ema50;
    if (adx == null || ema20 == null || ema50 == null) {
        return { regime: null, trendSide: null };
    }
    let regime;
    if (adx >= 25) regime = "trending";
    else if (adx <= 18) regime = "ranging";
    else regime = "transitional";
    let trendSide = null;
    if (ema20 > ema50) trendSide = "long";
    else if (ema20 < ema50) trendSide = "short";
    // EMA bằng nhau → không mặc định Short
    return { regime, trendSide, adx, ema20, ema50 };
}

function scoreRegime(side, reg, evidenceTime) {
    if (!reg.regime) {
        return rule("regime", side, null, "Thiếu ADX/EMA", 0, 2, evidenceTime, "Thiếu dữ liệu regime");
    }
    let points = 0;
    let condition = `${reg.regime}, ADX=${reg.adx}, EMA20/50`;
    if (reg.regime === "trending") {
        if (reg.trendSide === side) points = 2;
        else if (reg.trendSide && reg.trendSide !== side) points = -1;
        else points = 0;
        condition += reg.trendSide ? ` hướng ${reg.trendSide}` : " EMA bằng nhau";
    } else if (reg.regime === "ranging") points = 1;
    else points = 0;
    return rule("regime", side, reg.regime, condition, points, 2, evidenceTime, `Regime ${reg.regime}`);
}

function scoreRsi(side, rsi, evidenceTime) {
    if (rsi == null) return rule("rsi", side, null, "Thiếu RSI", 0, 1.5, evidenceTime, "Thiếu RSI");
    let points = 0;
    if (side === "long") {
        if (rsi < 45) points = 1.5;
        else if (rsi < 55) points = 0.5;
        else if (rsi > 70) points = -1;
    } else {
        if (rsi > 55) points = 1.5;
        else if (rsi > 45) points = 0.5;
        else if (rsi < 30) points = -1;
    }
    return rule("rsi", side, rsi, "RSI theo quy tắc market-v1", points, 1.5, evidenceTime, `RSI14=${rsi}`);
}

function scoreMacd(side, hist, evidenceTime) {
    if (hist == null) return rule("macd", side, null, "Thiếu MACD", 0, 1.5, evidenceTime, "Thiếu MACD");
    let points = 0;
    if (side === "long" && hist > 0) points = 1.5;
    if (side === "short" && hist < 0) points = 1.5;
    return rule("macd", side, hist, "Histogram MACD", points, 1.5, evidenceTime, `MACD hist=${hist}`);
}

function scoreSupertrend(side, direction, evidenceTime) {
    if (!direction) return rule("supertrend", side, null, "Thiếu Supertrend", 0, 1.5, evidenceTime, "Thiếu ST");
    let points = 0;
    if (side === "long" && direction === "up") points = 1.5;
    if (side === "short" && direction === "down") points = 1.5;
    return rule("supertrend", side, direction, "Supertrend ATR10×3", points, 1.5, evidenceTime, `ST ${direction}`);
}

function scoreBb(side, close, bb, evidenceTime) {
    if (close == null || bb?.lower == null || bb?.upper == null) {
        return rule("bb", side, null, "Thiếu BB", 0, 1, evidenceTime, "Thiếu Bollinger");
    }
    let points = 0;
    if (side === "long" && close <= bb.lower) points = 1;
    if (side === "short" && close >= bb.upper) points = 1;
    return rule("bb", side, close, "Vị trí so với band", points, 1, evidenceTime, `Close vs BB`);
}

function scoreSqueeze(side, squeezeBreakout, evidenceTime) {
    let points = 0;
    if (side === "long" && squeezeBreakout === "long") points = 1;
    if (side === "short" && squeezeBreakout === "short") points = 1;
    return rule(
        "squeeze_breakout",
        side,
        squeezeBreakout,
        "Breakout ≤3 nến sau squeeze BW<0.6×avg20",
        points,
        1,
        evidenceTime,
        squeezeBreakout ? `Breakout ${squeezeBreakout}` : "Không có breakout squeeze"
    );
}

function scoreDivergence(side, divergence, evidenceTime) {
    let points = 0;
    let explanation = "Không có divergence";
    if (side === "long" && divergence.bullish) {
        points = 1.5;
        explanation = divergence.bullish.explanation;
    }
    if (side === "short" && divergence.bearish) {
        points = 1.5;
        explanation = divergence.bearish.explanation;
    }
    return rule("divergence", side, points ? "yes" : null, "Pivot RSI divergence", points, 1.5, evidenceTime, explanation);
}

function scoreVolume(side, relVol, candle, evidenceTime) {
    if (relVol == null || !candle) {
        return rule("volume", side, null, "Thiếu volume", 0, 1, evidenceTime, "Thiếu relative volume");
    }
    let raw = 0;
    if (relVol > 2) raw = 1;
    else if (relVol > 1.3) raw = 0.5;
    else if (relVol < 0.5) raw = -0.5;
    const bodyLong = candle.close > candle.open;
    const bodyShort = candle.close < candle.open;
    let points = raw;
    if (raw > 0) {
        if (side === "long" && !bodyLong) points = 0;
        if (side === "short" && !bodyShort) points = 0;
    }
    return rule(
        "volume",
        side,
        relVol,
        "relVol vs avg20; điểm + cần body cùng chiều",
        points,
        1,
        evidenceTime,
        `relVol=${relVol}`
    );
}

function leadingBias(longScore, shortScore) {
    if (longScore == null && shortScore == null) return "wait";
    if (longScore == null) return "short";
    if (shortScore == null) return "long";
    if (longScore >= shortScore + 5) return "long";
    if (shortScore >= longScore + 5) return "short";
    return "wait";
}

function qualityOf({ closedBars, candleCloseTime, timeframe, now }) {
    if (closedBars < config.minClosedBars) {
        return {
            overall: closedBars < 30 ? "missing" : "warming",
            closedBars,
            minRequired: config.minClosedBars,
            stale: false,
        };
    }
    const interval = INTERVAL_MS[timeframe];
    const factor = STALE_FACTOR[timeframe] || 2;
    const age = now - candleCloseTime;
    const stale = interval > 0 && age > interval * factor;
    return {
        overall: stale ? "stale" : "ready",
        closedBars,
        minRequired: config.minClosedBars,
        stale,
        ageMs: age,
        staleAfterMs: interval * factor,
    };
}

/**
 * @param {Array} closedCandles nến đã đóng, sorted
 * @param {{ timeframe: string, now?: number, symbol?: string }} opts
 */
function scoreTimeframe(closedCandles, opts = {}) {
    const timeframe = opts.timeframe || "15m";
    const now = opts.now || Date.now();
    const calculatedAt = new Date(now).toISOString();

    if (!closedCandles?.length) {
        return {
            timeframe,
            formulaVersion: FORMULA_VERSION,
            longScore: null,
            shortScore: null,
            regime: null,
            bias: "wait",
            quality: { overall: "missing", closedBars: 0, minRequired: config.minClosedBars },
            breakdown: [],
            candleCloseTime: null,
            calculatedAt,
            dataVersion: null,
        };
    }

    const last = closedCandles[closedCandles.length - 1];
    const candleCloseTime = last.closeTime || last.openTime + (INTERVAL_MS[timeframe] || 0) - 1;
    const quality = qualityOf({
        closedBars: closedCandles.length,
        candleCloseTime,
        timeframe,
        now,
    });

    const ind = computeIndicators(closedCandles);
    if (!ind || quality.overall === "missing") {
        return {
            timeframe,
            formulaVersion: FORMULA_VERSION,
            longScore: null,
            shortScore: null,
            regime: null,
            bias: "wait",
            quality,
            breakdown: [],
            candleCloseTime,
            calculatedAt,
            dataVersion: `${timeframe}:${candleCloseTime}`,
            indicators: null,
        };
    }

    const ready = quality.overall === "ready" || quality.overall === "stale" || quality.overall === "warming";
    // Warming: vẫn tính nếu đủ chỉ báo tối thiểu (~60), nhưng score chính thức null khi < minClosedBars
    const canConfirmScore = closedCandles.length >= config.minClosedBars;

    const smc = analyzeSmc(closedCandles, { atr14: ind.atr14, rsiSeries: ind.rsiSeries });
    const reg = regimeOf(ind);
    const evidenceTime = candleCloseTime;

    const sides = ["long", "short"];
    const breakdown = [];
    const rawBySide = { long: 0, short: 0 };

    for (const side of sides) {
        const rules = [
            scoreRegime(side, reg, evidenceTime),
            scoreRsi(side, ind.rsi14, evidenceTime),
            scoreMacd(side, ind.macd.hist, evidenceTime),
            scoreSupertrend(side, ind.supertrend.direction, evidenceTime),
            scoreBb(side, ind.lastClose, ind.bb, evidenceTime),
            scoreSqueeze(side, ind.squeezeBreakout, evidenceTime),
            scoreDivergence(side, smc.divergence, evidenceTime),
            pickSmcPoints(smc.evidence, side).rule,
            scoreVolume(side, ind.relativeVolume, ind.candle, evidenceTime),
        ];
        for (const r of rules) {
            breakdown.push(r);
            rawBySide[side] += r.points;
        }
    }

    const longRaw = rawBySide.long;
    const shortRaw = rawBySide.short;
    const longScore = canConfirmScore ? normalizeScore(longRaw) : null;
    const shortScore = canConfirmScore ? normalizeScore(shortRaw) : null;

    return {
        timeframe,
        formulaVersion: FORMULA_VERSION,
        longScore,
        shortScore,
        longRaw: canConfirmScore ? round2(longRaw) : null,
        shortRaw: canConfirmScore ? round2(shortRaw) : null,
        regime: reg.regime,
        trendSide: reg.trendSide,
        bias: leadingBias(longScore, shortScore),
        quality: canConfirmScore
            ? quality
            : { ...quality, overall: quality.overall === "missing" ? "missing" : "warming" },
        breakdown,
        candleCloseTime,
        calculatedAt,
        dataVersion: `${timeframe}:${candleCloseTime}:${FORMULA_VERSION}`,
        structureBias: smc.structureBias,
        indicators: {
            lastClose: ind.lastClose,
            ema20: ind.ema20,
            ema50: ind.ema50,
            atr14: ind.atr14,
            rsi14: ind.rsi14,
            macdHist: ind.macd.hist,
            adx: ind.adx,
            bbUpper: ind.bb.upper,
            bbLower: ind.bb.lower,
            supertrend: ind.supertrend.direction,
            relativeVolume: ind.relativeVolume,
            squeeze: ind.squeeze,
        },
        ready,
    };
}

module.exports = {
    MAX_RAW,
    normalizeScore,
    leadingBias,
    scoreTimeframe,
    regimeOf,
    qualityOf,
};
