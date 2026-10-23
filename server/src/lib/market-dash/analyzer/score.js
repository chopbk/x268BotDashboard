/**
 * Signal Score 0–100 — docs/market.md
 * trend 25 · momentum/RS 20 · volume/flow 20 · positioning 20 · setup vol 15
 * ×0.8 nếu ngược regime BTC 1D
 */
function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
}

function scoreTrendStructure(ind, direction, higherTfInd) {
    let pts = 0;
    const parts = [];
    if (!ind) return { pts: 0, detail: "thiếu indicator" };
    const stackLong = ind.ema20 > ind.ema50 && ind.ema50 > ind.ema200;
    const stackShort = ind.ema20 < ind.ema50 && ind.ema50 < ind.ema200;
    if (direction === "long" && stackLong) {
        pts += 15;
        parts.push("EMA stack long");
    } else if (direction === "short" && stackShort) {
        pts += 15;
        parts.push("EMA stack short");
    } else if (
        (direction === "long" && ind.ema20 > ind.ema50) ||
        (direction === "short" && ind.ema20 < ind.ema50)
    ) {
        pts += 8;
        parts.push("EMA20/50 thuận");
    }
    if (higherTfInd) {
        const htLong = higherTfInd.ema20 > higherTfInd.ema50;
        if ((direction === "long" && htLong) || (direction === "short" && !htLong)) {
            pts += 10;
            parts.push("khung lớn đồng thuận");
        }
    } else {
        pts += 5;
    }
    return { pts: clamp(pts, 0, 25), detail: parts.join(", ") || "yếu" };
}

function scoreMomentumRs(rs7d, direction) {
    let pts = 10;
    const parts = [];
    if (rs7d == null) {
        return { pts: 8, detail: "thiếu RS 7d" };
    }
    // RS = coinReturn / btcReturn — >1 outperform
    if (direction === "long") {
        if (rs7d >= 1.2) pts = 20;
        else if (rs7d >= 1) pts = 15;
        else if (rs7d >= 0.8) pts = 10;
        else pts = 4;
        parts.push(`RS7d ${rs7d.toFixed(2)}`);
    } else {
        if (rs7d <= 0.8) pts = 20;
        else if (rs7d <= 1) pts = 15;
        else if (rs7d <= 1.2) pts = 10;
        else pts = 4;
        parts.push(`RS7d ${rs7d.toFixed(2)} (short)`);
    }
    return { pts: clamp(pts, 0, 20), detail: parts.join(", ") };
}

function scoreVolumeFlow(ind) {
    let pts = 8;
    if (ind?.relativeVolume != null) {
        if (ind.relativeVolume >= 2) pts = 20;
        else if (ind.relativeVolume >= 1.5) pts = 16;
        else if (ind.relativeVolume >= 1.2) pts = 12;
        else pts = 6;
        return { pts, detail: `vol ${ind.relativeVolume}×` };
    }
    return { pts: 6, detail: "thiếu vol" };
}

function scorePositioning(fundingPctile, oiDelta24h, direction) {
    let pts = 10;
    const parts = [];
    if (fundingPctile != null) {
        // Long thuận khi funding thấp (short đông); short thuận khi funding cao
        if (direction === "long") {
            if (fundingPctile <= 20) pts += 6;
            else if (fundingPctile >= 90) pts -= 6;
            parts.push(`funding p${fundingPctile}`);
        } else {
            if (fundingPctile >= 80) pts += 6;
            else if (fundingPctile <= 10) pts -= 6;
            parts.push(`funding p${fundingPctile}`);
        }
    }
    if (oiDelta24h != null) {
        if (direction === "long" && oiDelta24h > 0) pts += 4;
        if (direction === "short" && oiDelta24h > 0) pts += 4;
        parts.push(`OIΔ24h ${oiDelta24h.toFixed(1)}%`);
    }
    return { pts: clamp(pts, 0, 20), detail: parts.join(", ") || "trung tính" };
}

function scoreSetupVol(setup, ind, rr) {
    let pts = 8;
    const parts = [setup];
    if (ind?.relativeVolume >= 1.5) pts += 4;
    if (rr != null && rr >= 1.5) pts += 3;
    if (setup === "squeeze_breakout") pts += 2;
    return { pts: clamp(pts, 0, 15), detail: parts.join(", ") };
}

function againstRegime(direction, regime1d) {
    if (!regime1d) return false;
    if (direction === "long" && regime1d === "trend_down") return true;
    if (direction === "short" && regime1d === "trend_up") return true;
    return false;
}

/**
 * @returns {{ scoreRaw: number, score: number, breakdown: object, regimePenalty: boolean }}
 */
function computeSignalScore({
    setup,
    direction,
    ind,
    higherTfInd,
    rs7d,
    fundingPercentile,
    oiDelta24h,
    rr,
    regimeBtc1d,
}) {
    const trend = scoreTrendStructure(ind, direction, higherTfInd);
    const mom = scoreMomentumRs(rs7d, direction);
    const vol = scoreVolumeFlow(ind);
    const pos = scorePositioning(fundingPercentile, oiDelta24h, direction);
    const set = scoreSetupVol(setup, ind, rr);

    const scoreRaw = clamp(trend.pts + mom.pts + vol.pts + pos.pts + set.pts, 0, 100);
    const regimePenalty = againstRegime(direction, regimeBtc1d);
    const score = regimePenalty
        ? Math.round(scoreRaw * 0.8 * 10) / 10
        : scoreRaw;

    return {
        scoreRaw,
        score,
        regimePenalty,
        breakdown: {
            trend: { max: 25, ...trend },
            momentumRs: { max: 20, ...mom },
            volumeFlow: { max: 20, ...vol },
            positioning: { max: 20, ...pos },
            setupVol: { max: 15, ...set },
        },
    };
}

module.exports = {
    computeSignalScore,
    againstRegime,
    scoreTrendStructure,
    scoreMomentumRs,
    scoreVolumeFlow,
    scorePositioning,
    scoreSetupVol,
};
