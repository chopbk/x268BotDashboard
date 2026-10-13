const RISK_LEVELS = new Set(["normal", "attention", "high", "insufficient_data"]);

function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function clipStr(value, max = 400) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function nearEqual(a, b, tol = 0.02) {
    const x = num(a);
    const y = num(b);
    if (x == null || y == null) return false;
    if (x === y) return true;
    const scale = Math.max(Math.abs(x), Math.abs(y), 1e-9);
    return Math.abs(x - y) / scale <= tol;
}

function directionOk(side, role, mark, price) {
    const s = String(side || "").toUpperCase();
    const m = num(mark);
    const p = num(price);
    if (m == null || p == null || !(p > 0)) return false;
    if (role === "sl" || role === "invalidation" || role === "exit") {
        if (s === "LONG") return p < m;
        if (s === "SHORT") return p > m;
    }
    if (role === "tp") {
        if (s === "LONG") return p > m;
        if (s === "SHORT") return p < m;
    }
    return true;
}

function allowedPricesFromSnapshot(snapshot = {}) {
    const set = new Set();
    const add = (v) => {
        const n = num(v);
        if (n != null && n > 0) set.add(Number(n.toPrecision(10)));
    };
    const metrics = snapshot.metrics || {};
    add(metrics.sl);
    add(metrics.tp);
    add(metrics.mark);
    add(metrics.entry);
    add(metrics.liquidation);
    const market = snapshot.market || {};
    for (const level of market.levels || []) add(level.price);
    const cand = market.candidateLevels || {};
    for (const key of Object.keys(cand)) add(cand[key]);
    for (const sc of snapshot.scenarios || []) {
        const levels = sc.candidateLevels || {};
        for (const key of Object.keys(levels)) add(levels[key]);
    }
    return set;
}

function scrubCandidateLevels(levels, side, mark, allowed) {
    if (!levels || typeof levels !== "object") return null;
    const out = {};
    for (const [key, raw] of Object.entries(levels)) {
        if (key.endsWith("Source") || typeof raw === "string") {
            if (typeof raw === "string") out[key] = clipStr(raw, 40);
            continue;
        }
        const price = num(raw);
        if (price == null || !(price > 0)) continue;
        let role = "zone";
        if (/sl/i.test(key)) role = "sl";
        else if (/tp/i.test(key)) role = "tp";
        else if (/invalid|exit/i.test(key)) role = "invalidation";
        if ((role === "sl" || role === "tp" || role === "invalidation") && !directionOk(side, role, mark, price)) {
            continue;
        }
        if (allowed.size) {
            const keyNum = Number(price.toPrecision(10));
            const nearOk = [...allowed].some((p) => Math.abs(p - keyNum) / p < 0.005);
            if (!nearOk && !allowed.has(keyNum)) {
                // giữ mức đã có trong snapshot scenarios (code) — nếu không khớp thì bỏ
                continue;
            }
        }
        out[key] = price;
    }
    return Object.keys(out).length ? out : null;
}

/**
 * Validate + chuẩn hoá báo cáo AI/rules theo schema Phase 1.
 */
function validateReport(raw, snapshot = {}) {
    const side = snapshot.metrics?.side || snapshot.side || null;
    const mark = num(snapshot.metrics?.mark);
    const allowed = allowedPricesFromSnapshot(snapshot);
    const codeScenarios = Array.isArray(snapshot.scenarios) ? snapshot.scenarios : [];
    const codeById = new Map(codeScenarios.map((s) => [s.id, s]));

    const riskLevel = RISK_LEVELS.has(raw?.riskLevel) ? raw.riskLevel : (snapshot.riskLevelHint || "insufficient_data");

    const findings = (Array.isArray(raw?.findings) ? raw.findings : [])
        .map((f) => ({
            title: clipStr(f?.title, 120),
            detail: clipStr(f?.detail, 400),
            evidence: clipStr(f?.evidence, 240),
            severity: ["info", "warn", "critical"].includes(f?.severity) ? f.severity : "info",
        }))
        .filter((f) => f.title)
        .slice(0, 12);

    const scenarios = (Array.isArray(raw?.scenarios) ? raw.scenarios : codeScenarios)
        .map((s) => {
            const base = codeById.get(s?.id) || {};
            const id = clipStr(s?.id || base.id, 40) || "scenario";
            const merged = { ...base, ...s, id };
            const levels = scrubCandidateLevels(
                merged.candidateLevels || base.candidateLevels,
                side,
                mark,
                allowed
            );
            // qty không được lớn hơn vị thế
            let qtyImpact = merged.qtyImpact || base.qtyImpact || null;
            const maxQty = Math.abs(num(snapshot.metrics?.qty) || 0);
            if (qtyImpact && maxQty > 0) {
                const closeQty = num(qtyImpact.closeQty);
                if (closeQty != null && closeQty > maxQty * 1.01) {
                    qtyImpact = { ...qtyImpact, closeQty: maxQty, remainQty: 0, reducePct: 1, capped: true };
                }
            }
            // số PnL phải khớp snapshot nếu claim gần riskMarkToSl
            let riskFromMarkToSl = num(merged.riskFromMarkToSl);
            if (riskFromMarkToSl != null && base.riskFromMarkToSl != null
                && !nearEqual(riskFromMarkToSl, base.riskFromMarkToSl, 0.05)) {
                riskFromMarkToSl = base.riskFromMarkToSl;
            }
            return {
                id,
                title: clipStr(merged.title || base.title, 120) || id,
                rationale: clipStr(merged.rationale || base.rationale, 400),
                conditions: Array.isArray(merged.conditions)
                    ? merged.conditions.map((c) => clipStr(c, 160)).filter(Boolean).slice(0, 5)
                    : (base.conditions || []),
                candidateLevels: levels,
                qtyImpact,
                pnlEstimates: merged.pnlEstimates || base.pnlEstimates || null,
                riskFromMarkToSl: riskFromMarkToSl ?? base.riskFromMarkToSl ?? null,
                rrRemaining: num(merged.rrRemaining) ?? base.rrRemaining ?? null,
                accountBudgetImpact: merged.accountBudgetImpact ?? base.accountBudgetImpact ?? null,
                invalidation: clipStr(merged.invalidation || base.invalidation, 200),
            };
        })
        .filter((s) => s.title)
        .slice(0, 3);

    // Nếu AI bỏ scenarios — dùng code
    const finalScenarios = scenarios.length ? scenarios : codeScenarios.slice(0, 3);

    const priorities = (Array.isArray(raw?.priorities) ? raw.priorities : [])
        .map((p) => ({
            action: clipStr(p?.action, 160),
            why: clipStr(p?.why, 240),
            impact: clipStr(p?.impact, 160),
        }))
        .filter((p) => p.action)
        .slice(0, 5);

    const missingData = [...new Set([
        ...(Array.isArray(raw?.missingData) ? raw.missingData : []),
        ...(snapshot.missingData || []),
    ].map((x) => clipStr(x, 60)).filter(Boolean))].slice(0, 20);

    const invalidationConditions = (Array.isArray(raw?.invalidationConditions) ? raw.invalidationConditions : [])
        .map((x) => clipStr(x, 200))
        .filter(Boolean)
        .slice(0, 6);

    if (!invalidationConditions.length) {
        for (const s of finalScenarios) {
            if (s.invalidation) invalidationConditions.push(s.invalidation);
        }
    }

    let summary = clipStr(raw?.summary, 280);
    if (!summary) {
        summary = riskLevel === "insufficient_data"
            ? "Thiếu dữ liệu để đánh giá đầy đủ."
            : "Báo cáo rule dựa trên metrics đã tính.";
    }
    if (missingData.includes("risk_profile") && !/ngân sách rủi ro/i.test(summary)) {
        summary = `${summary} Chưa có ngân sách rủi ro cá nhân.`.trim();
    }

    return {
        summary,
        riskLevel,
        findings,
        scenarios: finalScenarios,
        priorities: priorities.length ? priorities : derivePriorities(finalScenarios, findings, riskLevel),
        missingData,
        invalidationConditions: invalidationConditions.slice(0, 6),
        snapshotId: snapshot.snapshotId || "",
        asOf: snapshot.asOf || new Date().toISOString(),
        meta: {
            model: raw?.meta?.model || null,
            promptVersion: raw?.meta?.promptVersion || "decision-v1",
            formulaVersion: snapshot.formulaVersion || "decision-v1",
            source: raw?.meta?.source === "ai" ? "ai" : "rules",
        },
    };
}

function derivePriorities(scenarios, findings, riskLevel) {
    const out = [];
    if (riskLevel === "high") {
        out.push({
            action: "Giảm rủi ro trước khi mở thêm lệnh",
            why: "Mức rủi ro hiện tại đang cao",
            impact: "Giới hạn thiệt hại nếu giá chạy ngược",
        });
    } else if (riskLevel === "attention") {
        out.push({
            action: "Rà soát stop-loss và quy mô trước khi giữ thêm",
            why: "Có điểm cần chú ý trên lệnh hoặc tài khoản",
            impact: "Tránh rủi ro âm thầm tích tụ",
        });
    }
    for (const f of findings.slice(0, 2)) {
        if (out.some((p) => p.action === f.title)) continue;
        out.push({
            action: f.title,
            why: f.detail || f.evidence,
            impact: f.severity === "critical" ? "Ưu tiên xử lý ngay" : f.severity === "warn" ? "Nên xử lý sớm" : "Ghi nhận",
        });
        if (out.length >= 3) break;
    }
    for (const s of scenarios.slice(0, 2)) {
        if (out.length >= 3) break;
        if (out.some((p) => p.action === s.title)) continue;
        out.push({
            action: s.title,
            why: s.rationale,
            impact: s.riskFromMarkToSl != null
                ? `Ước tính tới mức bảo vệ: ${s.riskFromMarkToSl}`
                : "",
        });
    }
    return out.slice(0, 3);
}

module.exports = {
    validateReport,
    directionOk,
    scrubCandidateLevels,
    RISK_LEVELS,
};
