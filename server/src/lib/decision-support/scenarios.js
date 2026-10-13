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
        title: "Giữ và quản trị theo mức hiện có",
        rationale: "Theo dõi theo SL/TP sàn và cấu trúc khung gần nhất; không thay đổi size.",
        conditions: ["Vị thế còn hợp lệ theo kế hoạch ban đầu", "Không vượt ngân sách rủi ro ngày"],
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
            ? `Giá chạm SL ${metrics.sl}`
            : "Thiếu SL sàn — invalidation chưa xác định",
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
        scenarios.push({
            id: "reduce_risk",
            title: reduce > 0 ? "Giảm rủi ro (siết SL + giảm 50%)" : "Giảm rủi ro (siết SL ứng viên)",
            rationale: `Mức SL ứng viên từ ${slCand.source}; chỉ là đề xuất — Phase 1 không tự áp.`,
            conditions: ["Cấu trúc/ATR đủ để đặt SL", "Xác nhận lại trước khi đặt lệnh"],
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
                ? { note: "Đối chiếu maxLossPerTrade khi áp (Phase 2)" }
                : null,
            invalidation: `Giá vượt SL ứng viên ${slCand.price}`,
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
            title: "Thoát khi mất invalidation",
            rationale: "Nếu mất cấu trúc / chạm mức hủy luận điểm thì ưu tiên thoát thay vì DCA.",
            conditions: [
                "Giá đóng nến vượt invalidation",
                riskProfile?.allowDca === false ? "Profile không cho phép DCA" : "Không thêm vị thế khi luận điểm gãy",
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
            invalidation: `Chạm/ vượt ${exitLevel}`,
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
        title: "Giữ và theo dõi coverage",
        rationale: "Duy trì vị thế hiện có; ưu tiên bổ sung SL cho lệnh thiếu và giảm tập trung symbol.",
        conditions: ["Equity và mark còn cập nhật"],
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
        invalidation: "Equity ≤ 0 hoặc mất dữ liệu wallet",
    });

    if (accountMetrics.missingSlCount > 0) {
        scenarios.push({
            id: "cover_missing_sl",
            title: "Ưu tiên phủ SL các vị thế thiếu",
            rationale: `${accountMetrics.missingSlCount} vị thế chưa có SL sàn.`,
            conditions: ["Có mark và entry để ước lượng rủi ro"],
            candidateLevels: null,
            qtyImpact: null,
            pnlEstimates: null,
            riskFromMarkToSl: null,
            rrRemaining: null,
            accountBudgetImpact: {
                symbols: accountMetrics.missingSl,
            },
            invalidation: "Tiếp tục mở thêm vị thế không SL",
        });
    }

    if (accountMetrics.profileBreaches?.length || (accountMetrics.exposurePct != null && accountMetrics.exposurePct > 250)) {
        scenarios.push({
            id: "reduce_exposure",
            title: "Giảm exposure / tập trung",
            rationale: "Gross notional hoặc concentration vượt ngưỡng an toàn / profile.",
            conditions: ["Chọn symbol lớn nhất để giảm trước"],
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
            invalidation: "Thêm vị thế cùng symbol đang tập trung",
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
