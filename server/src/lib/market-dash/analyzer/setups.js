/**
 * 3 setup MVP trên nến đã đóng — docs/market.md
 * Squeeze Breakout · Range Breakout · Trend Pullback
 */
const { computeDashIndicators, roundPrice } = require("./indicators");

function checklistItem(id, label, ok, detail = null) {
    return { id, label, ok: Boolean(ok), detail };
}

/**
 * Squeeze Breakout:
 * BB width ≤ p20 của 120 nến trong ≥ 12 nến, đóng trên đỉnh range/BB trên, vol ≥ 1.5× MA20
 */
function detectSqueezeBreakout(ind) {
    if (!ind || ind.closedBars < 130) return null;
    const checks = [];
    const sq = ind.squeeze;
    const streakOk = sq?.streak >= 12 || (sq?.inSqueeze && sq.streak >= 12);
    // Breakout: có squeeze streak gần đây (>=12) và nến đóng vượt BB upper / Donchian
    let priorSqueeze = false;
    if (sq) {
        // Cho phép vừa thoát squeeze: streak hiện tại có thể 0 nhưng p20 context
        priorSqueeze = sq.streak >= 12 || sq.inSqueeze;
        // Nếu đang in squeeze thì chưa breakout
        if (sq.inSqueeze && sq.streak >= 12) {
            checks.push(checklistItem("squeeze_len", "Squeeze ≥ 12 nến (BB≤p20)", true, `streak ${sq.streak}`));
            checks.push(checklistItem("breakout", "Đóng trên BB trên / Donchian", false, "Vẫn trong squeeze"));
            checks.push(
                checklistItem(
                    "volume",
                    "Volume ≥ 1.5× MA20",
                    ind.relativeVolume != null && ind.relativeVolume >= 1.5,
                    ind.relativeVolume != null ? `${ind.relativeVolume}×` : null
                )
            );
            return null; // chưa breakout
        }
    }

    // Look back: was in squeeze for >=12 bars ending within last 3 closed bars
    const bw = ind.bb?.bandwidthSeries;
    const lastIdx = bw.length - 1;
    let squeezeOk = false;
    let breakIdx = lastIdx;
    if (bw && sq) {
        // Check if last closed candle breaks out after squeeze
        for (let look = 0; look <= 2; look += 1) {
            const idx = lastIdx - look;
            if (idx < 120) break;
            // count squeeze streak ending at idx-1
            let streak = 0;
            const window = [];
            for (let i = idx - 120; i < idx; i += 1) {
                if (bw[i] != null) window.push(bw[i]);
            }
            const sorted = [...window].sort((a, b) => a - b);
            if (sorted.length < 50) continue;
            const p20 = sorted[Math.floor(0.2 * (sorted.length - 1))];
            for (let i = idx - 1; i >= 0; i -= 1) {
                if (bw[i] == null || bw[i] > p20) break;
                streak += 1;
            }
            if (streak >= 12) {
                squeezeOk = true;
                breakIdx = idx;
                break;
            }
        }
    }

    const close = ind.lastClose;
    const bbUpper = ind.bb?.upper;
    const donUpper = ind.donchian?.upper;
    const bbLower = ind.bb?.lower;
    const donLower = ind.donchian?.lower;

    const longBreak =
        (bbUpper != null && close >= bbUpper) || (donUpper != null && close >= donUpper);
    const shortBreak =
        (bbLower != null && close <= bbLower) || (donLower != null && close <= donLower);
    const volOk = ind.relativeVolume != null && ind.relativeVolume >= 1.5;

    checks.push(
        checklistItem("squeeze_len", "Squeeze ≥ 12 nến (BB≤p20)", squeezeOk, sq ? `streak ctx ${sq.streak}` : null)
    );
    checks.push(
        checklistItem(
            "breakout",
            "Đóng vượt BB/Donchian",
            longBreak || shortBreak,
            longBreak ? "long" : shortBreak ? "short" : "no"
        )
    );
    checks.push(
        checklistItem("volume", "Volume ≥ 1.5× MA20", volOk, ind.relativeVolume != null ? `${ind.relativeVolume}×` : null)
    );

    if (!squeezeOk || !(longBreak || shortBreak) || !volOk) return null;

    const direction = longBreak ? "long" : "short";
    return {
        setup: "squeeze_breakout",
        setupLabel: "Squeeze Breakout",
        direction,
        checklist: checks,
        breakIdx,
    };
}

/**
 * Range Breakout: đóng vượt Donchian 20, vol ≥ 1.5×, ATR đang mở rộng
 */
function detectRangeBreakout(ind) {
    if (!ind || ind.closedBars < 30) return null;
    const close = ind.lastClose;
    const donU = ind.donchian?.upper;
    const donL = ind.donchian?.lower;
    // So với Donchian của nến trước (tránh dùng high/low nến hiện tại làm ceiling)
    const upSeries = ind.donchian?.upperSeries;
    const loSeries = ind.donchian?.lowerSeries;
    const lastIdx = upSeries ? upSeries.length - 1 : -1;
    const prevUpper = lastIdx >= 1 ? upSeries[lastIdx - 1] : donU;
    const prevLower = lastIdx >= 1 ? loSeries[lastIdx - 1] : donL;

    const longBreak = prevUpper != null && close > prevUpper;
    const shortBreak = prevLower != null && close < prevLower;
    const volOk = ind.relativeVolume != null && ind.relativeVolume >= 1.5;
    const atrOk = Boolean(ind.atrExpanding);

    const checks = [
        checklistItem(
            "donchian",
            "Đóng vượt Donchian 20",
            longBreak || shortBreak,
            longBreak ? `> ${prevUpper}` : shortBreak ? `< ${prevLower}` : "no"
        ),
        checklistItem("volume", "Volume ≥ 1.5× MA20", volOk, ind.relativeVolume != null ? `${ind.relativeVolume}×` : null),
        checklistItem("atr", "ATR đang mở rộng", atrOk, null),
    ];

    if (!(longBreak || shortBreak) || !volOk || !atrOk) return null;
    return {
        setup: "range_breakout",
        setupLabel: "Range Breakout",
        direction: longBreak ? "long" : "short",
        checklist: checks,
    };
}

/**
 * Trend Pullback: EMA20>50>200, giá chạm EMA20–50, RSI14 trong 40–55 quay đầu
 */
function detectTrendPullback(ind) {
    if (!ind || ind.ema20 == null || ind.ema50 == null || ind.ema200 == null) return null;
    const stackLong = ind.ema20 > ind.ema50 && ind.ema50 > ind.ema200;
    const stackShort = ind.ema20 < ind.ema50 && ind.ema50 < ind.ema200;
    if (!stackLong && !stackShort) return null;

    const price = ind.lastClose;
    const lo = Math.min(ind.ema20, ind.ema50);
    const hi = Math.max(ind.ema20, ind.ema50);
    const inZone = price >= lo && price <= hi;
    // Cho phép touch bằng wick
    const touch =
        inZone ||
        (ind.lastLow <= hi && ind.lastHigh >= lo);

    const rsi = ind.rsi14;
    const rsiSeries = ind.rsiSeries || [];
    const lastIdx = rsiSeries.length - 1;
    const prevRsi = lastIdx >= 1 ? rsiSeries[lastIdx - 1] : null;

    let rsiOk = false;
    let direction = null;
    if (stackLong && rsi != null && rsi >= 40 && rsi <= 55) {
        // quay đầu lên: RSI hiện > RSI trước
        rsiOk = prevRsi == null || rsi >= prevRsi;
        direction = "long";
    }
    if (stackShort && rsi != null && rsi >= 45 && rsi <= 60) {
        // mirror cho short: RSI trong vùng trung tính hơi cao, quay xuống
        rsiOk = prevRsi == null || rsi <= prevRsi;
        direction = "short";
    }
    // Spec: RSI 40-55 quay đầu — primarily long pullback; short mirror allowed
    if (stackLong) direction = "long";
    if (stackShort) direction = "short";

    const checks = [
        checklistItem(
            "ema_stack",
            "EMA20>50>200 (hoặc ngược)",
            stackLong || stackShort,
            stackLong ? "bull stack" : "bear stack"
        ),
        checklistItem("touch", "Giá chạm vùng EMA20–50", touch, `${lo}–${hi}`),
        checklistItem(
            "rsi",
            "RSI14 40–55 (long) quay đầu",
            rsiOk,
            rsi != null ? `RSI ${rsi}` : null
        ),
    ];

    if (!(stackLong || stackShort) || !touch || !rsiOk) return null;
    return {
        setup: "trend_pullback",
        setupLabel: "Trend Pullback",
        direction,
        checklist: checks,
    };
}

function levelsForSetup(ind, direction) {
    const atr = ind.atr14 || 0;
    const entry = ind.lastClose;
    let stopLoss;
    let takeProfit;
    if (direction === "long") {
        stopLoss = roundPrice(entry - 1.5 * atr);
        takeProfit = roundPrice(entry + 2.5 * atr);
    } else {
        stopLoss = roundPrice(entry + 1.5 * atr);
        takeProfit = roundPrice(entry - 2.5 * atr);
    }
    const risk = Math.abs(entry - stopLoss);
    const reward = Math.abs(takeProfit - entry);
    const rr = risk > 0 ? Math.round((reward / risk) * 100) / 100 : null;
    return {
        entry,
        stopLoss,
        takeProfit,
        rr,
        entryZone: {
            low: direction === "long" ? roundPrice(entry - 0.3 * atr) : roundPrice(entry - 0.3 * atr),
            high: direction === "long" ? roundPrice(entry + 0.3 * atr) : roundPrice(entry + 0.3 * atr),
        },
    };
}

/**
 * Detect all setups on closed candles.
 * @returns {Array}
 */
function detectSetups(closedCandles) {
    const ind = computeDashIndicators(closedCandles);
    if (!ind) return [];
    const found = [];
    const detectors = [detectSqueezeBreakout, detectRangeBreakout, detectTrendPullback];
    for (const fn of detectors) {
        const hit = fn(ind);
        if (!hit) continue;
        const levels = levelsForSetup(ind, hit.direction);
        found.push({
            ...hit,
            ...levels,
            indicators: {
                ema20: ind.ema20,
                ema50: ind.ema50,
                ema200: ind.ema200,
                rsi14: ind.rsi14,
                atr14: ind.atr14,
                adx: ind.adx,
                relativeVolume: ind.relativeVolume,
            },
            candleCloseTime: ind.candleCloseTime,
            price: ind.lastClose,
        });
    }
    return found;
}

/** Điều kiện reset: setup không còn thỏa trên nến đóng mới nhất. */
function setupStillValid(closedCandles, setupName) {
    const found = detectSetups(closedCandles);
    return found.some((f) => f.setup === setupName);
}

module.exports = {
    detectSqueezeBreakout,
    detectRangeBreakout,
    detectTrendPullback,
    detectSetups,
    levelsForSetup,
    setupStillValid,
    computeDashIndicators,
};
