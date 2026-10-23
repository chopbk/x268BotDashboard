/**
 * Market Pulse 0–100 — trọng số theo docs/market.md.
 * Flow/Options stub null có lý do (V2).
 */
const { regimeLabelVi } = require("./regime");

function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
}

function pulseLabel(score) {
    if (score == null) return { key: "unknown", vi: "Chưa đủ dữ liệu" };
    if (score < 25) return { key: "risk_off_strong", vi: "Risk-off mạnh" };
    if (score < 45) return { key: "weak", vi: "Yếu" };
    if (score < 55) return { key: "neutral", vi: "Trung tính" };
    if (score < 75) return { key: "positive", vi: "Tích cực" };
    return { key: "euphoria", vi: "Hưng phấn" };
}

function scoreTrend(regime4h, regime1d, ind1d) {
    let pts = 50;
    const reasons = [];
    const r = regime1d?.regime || regime4h?.regime;
    if (r === "trend_up") {
        pts = 78;
        reasons.push(`Regime 1D/4H: ${regimeLabelVi(r)}`);
    } else if (r === "trend_down") {
        pts = 22;
        reasons.push(`Regime 1D/4H: ${regimeLabelVi(r)}`);
    } else if (r === "expansion") {
        pts = 62;
        reasons.push("Expansion — biến động mở rộng");
    } else if (r === "squeeze") {
        pts = 48;
        reasons.push("Squeeze — chờ bùng nổ");
    } else {
        pts = 50;
        reasons.push("Range / trung tính");
    }
    if (ind1d?.adx != null) reasons.push(`ADX 1D ${ind1d.adx}`);
    return { score: pts, reason: reasons.join("; "), weight: 25 };
}

function scoreBreadth(breadth) {
    // % coin trên EMA50 D — nếu chưa có thì stub
    if (!breadth || breadth.pctAboveEma50 == null) {
        return {
            score: null,
            reason: "Chưa đủ breadth (V2) — bỏ qua nhóm này",
            weight: 20,
            stub: true,
        };
    }
    const pct = breadth.pctAboveEma50;
    const score = clamp(pct, 0, 100);
    return {
        score,
        reason: `${pct.toFixed(0)}% top universe trên EMA50 D`,
        weight: 20,
    };
}

function scoreDerivatives(deriv) {
    if (!deriv) {
        return { score: null, reason: "Chưa có dữ liệu derivatives", weight: 20, stub: true };
    }
    let pts = 50;
    const parts = [];
    const f = deriv.fundingOiWeightedTop20;
    if (f != null) {
        // funding dương cao → đông long → hơi bearish cho pulse risk
        if (f > 0.0005) {
            pts -= 15;
            parts.push(`Funding OI-w ${(f * 100).toFixed(3)}% cao`);
        } else if (f < -0.0001) {
            pts += 12;
            parts.push(`Funding OI-w ${(f * 100).toFixed(3)}% âm (short đông)`);
        } else {
            parts.push(`Funding OI-w ${(f * 100).toFixed(3)}% bình thường`);
        }
    }
    const g = deriv.globalLongShort?.longShortRatio;
    if (g != null) {
        if (g > 1.2) {
            pts -= 8;
            parts.push(`Global L/S ${g.toFixed(2)} (long đông)`);
        } else if (g < 0.85) {
            pts += 8;
            parts.push(`Global L/S ${g.toFixed(2)} (short đông)`);
        }
    }
    return {
        score: clamp(pts, 0, 100),
        reason: parts.join("; ") || "Derivatives trung tính",
        weight: 20,
    };
}

function scoreFlow() {
    return {
        score: null,
        reason: "Stablecoin/ETF/CVD — V2 (chưa thu thập)",
        weight: 20,
        stub: true,
    };
}

function scoreVolRisk(ind1d, fearGreed) {
    let pts = 50;
    const parts = [];
    if (fearGreed != null) {
        pts = fearGreed;
        parts.push(`Fear & Greed ${fearGreed}`);
    }
    if (ind1d?.atr14 != null && ind1d?.lastClose) {
        const atrPct = (ind1d.atr14 / ind1d.lastClose) * 100;
        if (atrPct > 4) {
            pts = clamp(pts - 10, 0, 100);
            parts.push(`ATR% 1D ${atrPct.toFixed(1)} cao`);
        } else {
            parts.push(`ATR% 1D ${atrPct.toFixed(1)}`);
        }
    }
    if (!parts.length) {
        return { score: null, reason: "Thiếu vol/F&G", weight: 15, stub: true };
    }
    return { score: clamp(pts, 0, 100), reason: parts.join("; "), weight: 15 };
}

function buildPulse({
    regime4h,
    regime1d,
    ind1d,
    derivatives,
    macro,
    breadth,
    btcLevels,
}) {
    const groups = {
        trend: scoreTrend(regime4h, regime1d, ind1d),
        breadth: scoreBreadth(breadth),
        derivatives: scoreDerivatives(derivatives),
        flow: scoreFlow(),
        volRisk: scoreVolRisk(ind1d, macro?.fearGreed),
    };

    let wSum = 0;
    let sSum = 0;
    for (const g of Object.values(groups)) {
        if (g.score == null || g.stub) continue;
        wSum += g.weight;
        sSum += g.score * g.weight;
    }
    const score = wSum > 0 ? Math.round((sSum / wSum) * 10) / 10 : null;
    const label = pulseLabel(score);

    const brief = [];
    const rLabel = regimeLabelVi(regime1d?.regime || regime4h?.regime || "unknown");
    brief.push(`Regime BTC: ${rLabel} (${(regime1d || regime4h)?.reasons?.[0] || "—"})`);

    // Điểm bất thường lớn nhất
    const anomalies = [];
    if (derivatives?.fundingOiWeightedTop20 != null) {
        const f = derivatives.fundingOiWeightedTop20;
        if (Math.abs(f) > 0.0003) {
            anomalies.push(`Funding OI-weighted ${(f * 100).toFixed(3)}%`);
        }
    }
    if (macro?.fearGreed != null && (macro.fearGreed <= 25 || macro.fearGreed >= 75)) {
        anomalies.push(`F&G ${macro.fearGreed} (${macro.fearGreedLabel || ""})`);
    }
    brief.push(
        anomalies.length
            ? `Bất thường: ${anomalies.join("; ")}`
            : "Không có bất thường lớn trên funding/F&G"
    );

    if (btcLevels?.support != null || btcLevels?.resistance != null) {
        brief.push(
            `Canh BTC: hỗ trợ ~${btcLevels.support ?? "—"} · kháng cự ~${btcLevels.resistance ?? "—"}`
        );
    } else if (ind1d?.donchian) {
        brief.push(
            `Canh BTC Donchian20: ${ind1d.donchian.lower?.toFixed?.(0) ?? ind1d.donchian.lower} – ${ind1d.donchian.upper?.toFixed?.(0) ?? ind1d.donchian.upper}`
        );
    } else {
        brief.push("Chưa đủ mức giá BTC để canh");
    }

    const hot =
        score != null &&
        score > 80 &&
        derivatives?.fundingOiWeightedTop20 != null &&
        derivatives.fundingOiWeightedTop20 > 0.0004;

    return {
        score,
        label: label.vi,
        labelKey: label.key,
        regime: {
            "4h": regime4h
                ? { regime: regime4h.regime, label: regimeLabelVi(regime4h.regime), reasons: regime4h.reasons }
                : null,
            "1d": regime1d
                ? { regime: regime1d.regime, label: regimeLabelVi(regime1d.regime), reasons: regime1d.reasons }
                : null,
        },
        groups,
        brief,
        hotWarning: hot
            ? "Thị trường hưng phấn, funding cao — rủi ro đảo chiều"
            : null,
        weightsUsed: wSum,
        updatedAt: new Date().toISOString(),
    };
}

module.exports = {
    buildPulse,
    pulseLabel,
    scoreTrend,
    scoreDerivatives,
    scoreVolRisk,
};
