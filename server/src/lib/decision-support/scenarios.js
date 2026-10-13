const { pnlLinear } = require("./position-metrics");

function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function round(value, digits = 4) {
    const n = num(value);
    if (n == null) return null;
    return Number(n.toFixed(digits));
}

function pickSlCandidate(side, market, metrics) {
    const s = String(side || "").toUpperCase();
    const levels = market?.candidateLevels || {};
    const atr = num(market?.atr14 ?? market?.tf15?.atr14);
    const mark = num(metrics.mark);
    const structure = s === "LONG"
        ? (num(levels.structureSlLong) ?? num(levels.swingLow))
        : (num(levels.structureSlShort) ?? num(levels.swingHigh));
    if (structure != null && mark != null) {
        if (s === "LONG" && structure < mark) return { price: structure, source: "structure" };
        if (s === "SHORT" && structure > mark) return { price: structure, source: "structure" };
    }
    if (atr != null && mark != null) {
        const buf = atr * 1.2;
        if (s === "LONG") return { price: round(mark - buf, 6), source: "atr_1_2" };
        if (s === "SHORT") return { price: round(mark + buf, 6), source: "atr_1_2" };
    }
    return null;
}

function pickTpCandidate(side, market, metrics) {
    const s = String(side || "").toUpperCase();
    const levels = market?.candidateLevels || {};
    const atr = num(market?.atr14 ?? market?.tf15?.atr14);
    const mark = num(metrics.mark);
    const structure = s === "LONG"
        ? (num(levels.structureTpLong) ?? num(levels.swingHigh))
        : (num(levels.structureTpShort) ?? num(levels.swingLow));
    if (structure != null && mark != null) {
        if (s === "LONG" && structure > mark) return { price: structure, source: "structure" };
        if (s === "SHORT" && structure < mark) return { price: structure, source: "structure" };
    }
    if (atr != null && mark != null) {
        const buf = atr * 2;
        if (s === "LONG") return { price: round(mark + buf, 6), source: "atr_2" };
        if (s === "SHORT") return { price: round(mark - buf, 6), source: "atr_2" };
    }
    return null;
}

function buildQtyImpact(metrics, reducePct) {
    const qty = Math.abs(num(metrics.qty) || 0);
    if (!(qty > 0)) return null;
    const reduce = Math.min(1, Math.max(0, reducePct));
    return {
        currentQty: qty,
        reducePct: reduce,
        closeQty: round(qty * reduce, 6),
        remainQty: round(qty * (1 - reduce), 6),
    };
}

/**
 * Tối đa 3 phương án code-only. Bỏ nếu thiếu dữ liệu bắt buộc.
 */
function buildPositionScenarios(metrics, market = null, riskProfile = null) {
    const scenarios = [];
    const side = metrics?.side;
    const mark = num(metrics?.mark);
    const qty = Math.abs(num(metrics?.qty) || 0);
    // Number(null)===0 — coi mark thiếu nếu không > 0
    if (!side || !(mark > 0) || !(qty > 0)) {
        return { scenarios: [], missingForScenarios: ["mark_or_qty"] };
    }

    const missingForScenarios = [];

    // 1) Giữ / quản trị theo SL-TP hiện có
    const hold = {
        id: "hold_manage",
        title: "Giữ lệnh, quản theo mức hiện có",
        rationale: "Tiếp tục theo stop-loss / take-profit trên sàn và cấu trúc giá gần nhất; chưa đổi khối lượng.",
        conditions: ["Luận điểm ban đầu vẫn còn hiệu lực", "Chưa vượt hạn mức lỗ trong ngày"],
        candidateLevels: {
            sl: metrics.sl,
            tp: metrics.tp,
            invalidation: metrics.sl,
        },
        qtyImpact: buildQtyImpact(metrics, 0),
        pnlEstimates: {
            toSl: metrics.riskMarkToSl,
            toTp: metrics.rewardMarkToTp,
            unrealized: metrics.unrealized,
        },
        riskFromMarkToSl: metrics.riskMarkToSl,
        rrRemaining: metrics.rrRemaining,
        accountBudgetImpact: null,
        invalidation: metrics.sl != null
            ? `Thoát kế hoạch nếu giá chạm stop-loss ${metrics.sl}`
            : "Chưa có stop-loss trên sàn — chưa xác định mức hủy luận điểm",
    };
    scenarios.push(hold);

    // 2) Giảm rủi ro: siết SL ứng viên + optional giảm 50%
    const slCand = pickSlCandidate(side, market, metrics);
    const tpCand = pickTpCandidate(side, market, metrics);
    if (slCand) {
        const riskNew = pnlLinear(side, mark, slCand.price, qty);
        const rewardNew = tpCand ? pnlLinear(side, mark, tpCand.price, qty) : metrics.rewardMarkToTp;
        let rr = null;
        if (riskNew != null && riskNew < 0 && rewardNew != null && rewardNew > 0) {
            rr = round(rewardNew / Math.abs(riskNew), 3);
        }
        const reduce = metrics.sl == null || (riskNew != null && metrics.riskMarkToSl != null
            && Math.abs(riskNew) < Math.abs(metrics.riskMarkToSl) * 0.85)
            ? 0
            : 0.5;
        const slSourceLabel = slCand.source === "structure"
            ? "cấu trúc giá"
            : slCand.source === "atr_1_2"
                ? "biên độ ATR"
                : slCand.source;
        scenarios.push({
            id: "reduce_risk",
            title: reduce > 0 ? "Siết stop-loss và giảm một nửa khối lượng" : "Siết stop-loss theo mức đề xuất",
            rationale: `Mức cắt lỗ gợi ý lấy từ ${slSourceLabel}. Đây chỉ là ứng viên — bạn tự quyết định khi đặt lệnh.`,
            conditions: ["Có cấu trúc hoặc ATR đủ để đặt cắt lỗ", "Xác nhận lại giá và khối lượng trước khi gửi sàn"],
            candidateLevels: {
                sl: slCand.price,
                tp: tpCand?.price ?? metrics.tp,
                slSource: slCand.source,
                tpSource: tpCand?.source || null,
            },
            qtyImpact: buildQtyImpact(metrics, reduce),
            pnlEstimates: {
                toSl: riskNew,
                toTp: rewardNew,
            },
            riskFromMarkToSl: riskNew,
            rrRemaining: rr,
            accountBudgetImpact: riskProfile?.maxLossPerTrade
                ? { note: "Đối chiếu hạn mức lỗ mỗi lệnh khi áp dụng (Phase 2)" }
                : null,
            invalidation: `Hủy phương án nếu giá vượt stop đề xuất ${slCand.price}`,
        });
    } else {
        missingForScenarios.push("sl_candidate");
    }

    // 3) Thoát / invalidation
    const inv = market?.candidateLevels?.invalidation
        ?? (String(side).toUpperCase() === "LONG"
            ? market?.candidateLevels?.swingLow
            : market?.candidateLevels?.swingHigh);
    if (inv != null || metrics.sl != null) {
        const exitLevel = num(inv) ?? metrics.sl;
        const pnlExit = pnlLinear(side, mark, exitLevel, qty);
        scenarios.push({
            id: "exit_invalidation",
            title: "Đóng lệnh khi mất luận điểm",
            rationale: "Nếu giá phá mức hủy cấu trúc, ưu tiên thoát sạch thay vì trung bình giá thêm.",
            conditions: [
                "Nến đóng vượt mức hủy luận điểm",
                riskProfile?.allowDca === false
                    ? "Hồ sơ của bạn không cho phép DCA"
                    : "Không tăng vị thế khi luận điểm đã gãy",
            ],
            candidateLevels: {
                exit: exitLevel,
                invalidation: exitLevel,
            },
            qtyImpact: buildQtyImpact(metrics, 1),
            pnlEstimates: {
                toExit: pnlExit,
            },
            riskFromMarkToSl: pnlExit,
            rrRemaining: null,
            accountBudgetImpact: null,
            invalidation: `Thực hiện khi giá chạm hoặc vượt ${exitLevel}`,
        });
    } else {
        missingForScenarios.push("invalidation_level");
    }

    return {
        scenarios: scenarios.slice(0, 3),
        missingForScenarios,
    };
}

/**
 * Scenarios cấp tài khoản (rút gọn Phase 1).
 */
function buildAccountScenarios(accountMetrics) {
    const scenarios = [];
    if (!accountMetrics) return { scenarios: [], missingForScenarios: ["account_metrics"] };

    scenarios.push({
        id: "hold_monitor",
        title: "Giữ danh mục và theo dõi bảo vệ",
        rationale: "Duy trì vị thế hiện có; ưu tiên gắn stop-loss cho lệnh thiếu và hạn chế dồn một coin.",
        conditions: ["Số dư và giá mark còn cập nhật"],
        candidateLevels: null,
        qtyImpact: null,
        pnlEstimates: {
            totalUnrealized: accountMetrics.totalUnrealized,
        },
        riskFromMarkToSl: null,
        rrRemaining: null,
        accountBudgetImpact: {
            exposurePct: accountMetrics.exposurePct,
            missingSlCount: accountMetrics.missingSlCount,
        },
        invalidation: "Vốn về ≤ 0 hoặc mất dữ liệu ví",
    });

    if (accountMetrics.missingSlCount > 0) {
        scenarios.push({
            id: "cover_missing_sl",
            title: "Gắn stop-loss cho lệnh còn thiếu",
            rationale: `Còn ${accountMetrics.missingSlCount} vị thế chưa có cắt lỗ trên sàn.`,
            conditions: ["Có giá mark và giá vào để ước lượng rủi ro"],
            candidateLevels: null,
            qtyImpact: null,
            pnlEstimates: null,
            riskFromMarkToSl: null,
            rrRemaining: null,
            accountBudgetImpact: {
                symbols: accountMetrics.missingSl,
            },
            invalidation: "Tiếp tục mở thêm lệnh không có stop-loss",
        });
    }

    if (accountMetrics.profileBreaches?.length || (accountMetrics.exposurePct != null && accountMetrics.exposurePct > 250)) {
        scenarios.push({
            id: "reduce_exposure",
            title: "Giảm quy mô hoặc bớt tập trung",
            rationale: "Tổng vị thế hoặc tỷ trọng một coin đang cao hơn mức an toàn / hồ sơ của bạn.",
            conditions: ["Giảm symbol đang chiếm tỷ trọng lớn trước"],
            candidateLevels: null,
            qtyImpact: null,
            pnlEstimates: null,
            riskFromMarkToSl: null,
            rrRemaining: null,
            accountBudgetImpact: {
                topSymbol: accountMetrics.topSymbol,
                exposurePct: accountMetrics.exposurePct,
                breaches: accountMetrics.profileBreaches,
            },
            invalidation: "Tiếp tục thêm vị thế cùng symbol đang tập trung",
        });
    }

    return {
        scenarios: scenarios.slice(0, 3),
        missingForScenarios: accountMetrics.missingData || [],
    };
}

module.exports = {
    buildPositionScenarios,
    buildAccountScenarios,
    pickSlCandidate,
    pickTpCandidate,
};
