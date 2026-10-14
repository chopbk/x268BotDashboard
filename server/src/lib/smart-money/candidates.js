/**
 * Xếp hạng ứng viên bằng code — không inflate khi thiếu dữ liệu.
 */
const SmartMoneyCandidate = require("../../models/smart-money-candidate");
const { CANDIDATE_VERSION, config } = require("./config");
const { finite } = require("./formulas");

function gate(snapshot) {
    if (!snapshot) return { ok: false, reason: "no_snapshot" };
    if (snapshot.tracking?.active === false) return { ok: false, reason: "inactive" };
    if (snapshot.quality?.overall === "warming") return { ok: false, reason: "warming" };
    if (snapshot.quality?.stale) return { ok: false, reason: "stale" };
    const missingCritical = (snapshot.quality?.missing || []).includes("price");
    if (missingCritical) return { ok: false, reason: "missing_price" };
    // Cần ít nhất OI hoặc Smart Money
    const hasSm = snapshot.smartMoney?.status === "ok";
    const hasOi = snapshot.openInterest?.status === "ok";
    if (!hasSm && !hasOi) return { ok: false, reason: "insufficient_sources" };
    return { ok: true, reason: null };
}

function coverageScore(snapshot) {
    const keys = ["price", "openInterest", "funding", "topTrader", "taker", "smartMoney"];
    let ok = 0;
    for (const k of keys) {
        if (snapshot[k]?.status === "ok") ok += 1;
    }
    return { score: ok / keys.length, okCount: ok, total: keys.length };
}

function scoreSnapshot(snapshot) {
    const g = gate(snapshot);
    if (!g.ok) return null;

    const cov = coverageScore(snapshot);
    const reasons = [];
    const risks = [];
    let longPts = 0;
    let shortPts = 0;
    let anomalyPts = 0;

    const bias = snapshot.derived?.bias;
    const whaleBias = snapshot.derived?.whaleBias;
    if (bias === "long") {
        longPts += 2;
        reasons.push("Nhóm trader nghiêng Long (quantity)");
    } else if (bias === "short") {
        shortPts += 2;
        reasons.push("Nhóm trader nghiêng Short (quantity)");
    } else if (bias === "both") {
        risks.push("Long/Short gần cân bằng");
    }

    if (whaleBias === "long" && bias === "long") {
        longPts += 1.5;
        reasons.push("Whale cùng nghiêng Long");
    } else if (whaleBias === "short" && bias === "short") {
        shortPts += 1.5;
        reasons.push("Whale cùng nghiêng Short");
    } else if (whaleBias && bias && whaleBias !== bias && whaleBias !== "unclear" && bias !== "unclear" && bias !== "both") {
        risks.push("Whale và nhóm trader mâu thuẫn");
        anomalyPts += 1;
    }

    const oiPct = finite(snapshot.openInterest?.deltaPct);
    const px = finite(snapshot.price?.changePct24h);
    if (oiPct != null && Math.abs(oiPct) >= config.minAbsDeltaPct) {
        if (px != null && Math.sign(oiPct) === Math.sign(px)) {
            anomalyPts += 1;
            reasons.push(`OI và giá cùng chiều (OI ${oiPct.toFixed(1)}%)`);
        } else if (px != null && Math.sign(oiPct) !== Math.sign(px)) {
            risks.push("OI và giá ngược chiều");
            anomalyPts += 0.5;
        }
    }

    const taker = finite(snapshot.taker?.buySellRatio);
    if (taker != null) {
        if (taker >= 1.2) {
            longPts += 0.8;
            reasons.push(`Taker nghiêng mua (${taker.toFixed(2)})`);
        } else if (taker <= 0.8) {
            shortPts += 0.8;
            reasons.push(`Taker nghiêng bán (${taker.toFixed(2)})`);
        }
    }

    const funding = finite(snapshot.funding?.currentRate);
    if (funding != null && Math.abs(funding) > 0.0005) {
        risks.push(
            funding > 0
                ? "Funding dương cao — crowding Long (cảnh báo, không phải tín hiệu thuận)"
                : "Funding âm mạnh — crowding Short (cảnh bảo)"
        );
        // Không cộng điểm xu hướng từ funding cực đoan
    }

    // Không chuẩn hóa lại để thiếu data trông tốt hơn: nhân với coverage
    const rawLong = longPts * cov.score;
    const rawShort = shortPts * cov.score;
    const rawAnom = anomalyPts * cov.score;

    let bucket = "contradiction";
    let lean = "unclear";
    let score = Math.max(rawLong, rawShort, rawAnom);
    if (risks.some((r) => /mâu thuẫn/i.test(r)) && Math.abs(rawLong - rawShort) < 1) {
        bucket = "contradiction";
        lean = "unclear";
    } else if (rawAnom >= rawLong && rawAnom >= rawShort && rawAnom >= 1.2) {
        bucket = "anomaly";
        lean = "unclear";
        score = rawAnom;
    } else if (rawLong >= rawShort && rawLong >= 1.5) {
        bucket = "lean_long";
        lean = "long";
        score = rawLong;
    } else if (rawShort > rawLong && rawShort >= 1.5) {
        bucket = "lean_short";
        lean = "short";
        score = rawShort;
    } else {
        return null; // không đủ điều kiện → không vào danh sách
    }

    if (cov.okCount < 3) {
        return null; // coverage thấp — loại, không điểm cao giả
    }

    return {
        symbol: snapshot.symbol,
        bucket,
        lean,
        score: Math.round(score * 100) / 100,
        coverage: cov,
        reasons: reasons.slice(0, 3),
        risks: risks.slice(0, 3),
        waitFor: cov.score < 0.85 ? ["Chờ đủ nguồn Smart Money/OI/taker"] : [],
        invalidation: [
            "Cohort Smart Money đổi",
            "Dữ liệu stale hoặc nguồn lỗi",
            lean === "long" ? "Whale quay sang Short rõ" : lean === "short" ? "Whale quay sang Long rõ" : "Bias trở lại cân bằng",
        ],
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        collectedAt: snapshot.collectedAt,
        version: CANDIDATE_VERSION,
        note: "Điểm không phải xác suất thắng.",
    };
}

async function rebuildCandidates(snapshots) {
    const items = [];
    for (const snap of snapshots) {
        const row = scoreSnapshot(snap);
        if (row) items.push(row);
    }
    items.sort((a, b) => b.score - a.score);
    const limited = items.slice(0, config.candidateLimitMax);
    const generatedAt = new Date();
    const doc = {
        _id: CANDIDATE_VERSION,
        version: CANDIDATE_VERSION,
        generatedAt,
        expiresAt: new Date(generatedAt.getTime() + 2 * 60 * 60 * 1000),
        items: limited,
    };
    await SmartMoneyCandidate.findByIdAndUpdate(CANDIDATE_VERSION, doc, { upsert: true, new: true });
    return doc;
}

async function getCandidates() {
    const doc = await SmartMoneyCandidate.findById(CANDIDATE_VERSION).lean();
    return doc || { version: CANDIDATE_VERSION, generatedAt: null, items: [], warming: true };
}

module.exports = { gate, scoreSnapshot, rebuildCandidates, getCandidates, coverageScore };
