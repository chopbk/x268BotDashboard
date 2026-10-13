const { aiSettings, providerConfig, chatRequest, readChatText } = require("../dashboard-brief");
const { validateReport } = require("./validate-report");

const PROMPT_VERSION = "decision-v1";
const FORMULA_VERSION = "decision-v1";

const SYSTEM = [
    "Bạn là trợ lý phân tích rủi ro giao dịch futures. Chỉ giải thích số liệu đã tính sẵn.",
    "Không bịa giá, không đề xuất số ngoài snapshot.scenarios / market.levels / metrics.",
    "Không bảo user đặt lệnh tự động. Phase 1 chỉ đọc.",
    "Trả đúng JSON schema: summary, riskLevel (normal|attention|high|insufficient_data),",
    "findings[{title,detail,evidence,severity}], scenarios[{id,title,rationale,conditions,candidateLevels,qtyImpact,pnlEstimates,riskFromMarkToSl,rrRemaining,accountBudgetImpact,invalidation}],",
    "priorities[{action,why,impact}], missingData[], invalidationConditions[].",
    "Dùng tiếng Việt, ngắn. Giữ scenarios.id khớp snapshot (hold_manage|reduce_risk|exit_invalidation|...).",
    "Nếu missingData có risk_profile: nhắc chưa có ngân sách rủi ro cá nhân.",
].join(" ");

async function callProvider(settings, system, user, fetchImpl) {
    const request = chatRequest(settings, system, user);
    // Tăng token cho schema dài hơn dashboard brief
    if (request.body?.generationConfig) {
        request.body.generationConfig.maxOutputTokens = 2000;
    } else if (request.body?.max_tokens != null) {
        request.body.max_tokens = 2000;
    }
    const res = await fetchImpl(request.url, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: AbortSignal.timeout(22000),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
        const error = new Error("AI không trả lời");
        error.statusCode = res.status;
        throw error;
    }
    const text = readChatText(settings.provider, payload);
    if (!text) {
        const error = new Error("AI không trả lời");
        error.statusCode = 502;
        throw error;
    }
    return text;
}

function parseJsonObject(text) {
    const raw = String(text || "");
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
        return JSON.parse(raw.slice(start, end + 1));
    } catch {
        return null;
    }
}

function buildRulesReport(snapshot) {
    const missing = [...(snapshot.missingData || [])];
    const findings = [];
    const metrics = snapshot.metrics || {};
    const account = snapshot.accountMetrics || null;

    if (snapshot.scope === "position") {
        if (metrics.sl == null) {
            findings.push({
                title: "Thiếu SL sàn",
                detail: "Vị thế chưa có stop loss trên sàn.",
                evidence: "exchange_sl null",
                severity: "critical",
            });
        }
        if (metrics.marketAlignment === "against") {
            findings.push({
                title: "Ngược cấu trúc đa khung",
                detail: "Side đang ngược alignment thị trường.",
                evidence: `multiTf=${snapshot.market?.multiTf}`,
                severity: "warn",
            });
        }
        if (metrics.liqDistancePct != null && metrics.liqDistancePct < 5) {
            findings.push({
                title: "Gần thanh lý",
                detail: `Khoảng tới liq ~${metrics.liqDistancePct}% từ mark.`,
                evidence: `liq=${metrics.liquidation}`,
                severity: "critical",
            });
        }
        if (metrics.rrRemaining != null && metrics.rrRemaining < 1) {
            findings.push({
                title: "R:R còn lại thấp",
                detail: `R:R mark→TP/SL ≈ ${metrics.rrRemaining}`,
                evidence: `riskMarkToSl=${metrics.riskMarkToSl}, rewardMarkToTp=${metrics.rewardMarkToTp}`,
                severity: "warn",
            });
        }
    } else if (account) {
        if (account.missingSlCount > 0) {
            findings.push({
                title: "Có vị thế thiếu SL",
                detail: `${account.missingSlCount} vị thế chưa phủ SL.`,
                evidence: JSON.stringify(account.missingSl?.slice(0, 5) || []),
                severity: account.missingSlCount >= 2 ? "critical" : "warn",
            });
        }
        for (const b of account.profileBreaches || []) {
            findings.push({
                title: "Vượt hồ sơ rủi ro",
                detail: b.detail,
                evidence: b.code,
                severity: "warn",
            });
        }
        if (account.exposurePct != null && account.exposurePct > 300) {
            findings.push({
                title: "Exposure cao",
                detail: `Gross notional/equity ≈ ${account.exposurePct}%`,
                evidence: `grossNotional=${account.grossNotional}`,
                severity: "warn",
            });
        }
    }

    if (missing.includes("risk_profile")) {
        findings.push({
            title: "Chưa có ngân sách rủi ro cá nhân",
            detail: "Thiếu riskProfile — báo cáo không tự gán ngưỡng giả.",
            evidence: "risk_profile",
            severity: "info",
        });
    }

    let riskLevel = snapshot.riskLevelHint || "normal";
    if (missing.includes("equity") || (snapshot.scope === "position" && metrics.mark == null)) {
        riskLevel = "insufficient_data";
    } else if (findings.some((f) => f.severity === "critical")) {
        riskLevel = "high";
    } else if (findings.some((f) => f.severity === "warn") && riskLevel === "normal") {
        riskLevel = "attention";
    }

    const summaryParts = [];
    if (snapshot.scope === "position") {
        summaryParts.push(`${metrics.symbol || "?"} ${metrics.side || ""}`.trim());
        if (metrics.unrealized != null) summaryParts.push(`uPnL ${metrics.unrealized}`);
        if (metrics.sl == null) summaryParts.push("chưa có SL");
        else if (metrics.riskMarkToSl != null) summaryParts.push(`rủi ro mark→SL ≈ ${metrics.riskMarkToSl}`);
    } else {
        summaryParts.push(`Tài khoản ${snapshot.account || "?"}`);
        if (account?.positionCount != null) summaryParts.push(`${account.positionCount} vị thế`);
        if (account?.missingSlCount) summaryParts.push(`${account.missingSlCount} thiếu SL`);
        if (account?.exposurePct != null) summaryParts.push(`exposure ${account.exposurePct}%`);
    }

    return {
        summary: summaryParts.filter(Boolean).join(" · ") || "Báo cáo rule",
        riskLevel,
        findings,
        scenarios: snapshot.scenarios || [],
        priorities: [],
        missingData: missing,
        invalidationConditions: [],
        meta: {
            model: null,
            promptVersion: PROMPT_VERSION,
            formulaVersion: FORMULA_VERSION,
            source: "rules",
        },
    };
}

async function generateAiReport(snapshot, deps = {}) {
    const rulesRaw = buildRulesReport(snapshot);
    const primary = aiSettings();
    if (!primary.configured || deps.forceRules) {
        return validateReport(rulesRaw, {
            ...snapshot,
            formulaVersion: FORMULA_VERSION,
        });
    }

    const fetchImpl = deps.fetchImpl || fetch;
    const prompt = [
        "Snapshot đã tính (chỉ dùng số này):",
        JSON.stringify({
            scope: snapshot.scope,
            account: snapshot.account,
            metrics: snapshot.metrics,
            accountMetrics: snapshot.accountMetrics
                ? {
                    equity: snapshot.accountMetrics.equity,
                    available: snapshot.accountMetrics.available,
                    positionCount: snapshot.accountMetrics.positionCount,
                    grossNotional: snapshot.accountMetrics.grossNotional,
                    exposurePct: snapshot.accountMetrics.exposurePct,
                    missingSl: snapshot.accountMetrics.missingSl,
                    concentration: snapshot.accountMetrics.concentration?.slice(0, 5),
                    profileBreaches: snapshot.accountMetrics.profileBreaches,
                    riskLevelHint: snapshot.accountMetrics.riskLevelHint,
                    missingData: snapshot.accountMetrics.missingData,
                }
                : null,
            market: snapshot.market
                ? {
                    multiTf: snapshot.market.multiTf,
                    alignment: snapshot.market.alignment,
                    atr14: snapshot.market.atr14,
                    tf15: snapshot.market.tf15,
                    tf1h: snapshot.market.tf1h,
                    tf4h: {
                        trendVsEma: snapshot.market.tf4h?.trendVsEma,
                        structure: snapshot.market.tf4h?.structure,
                        rsi14: snapshot.market.tf4h?.rsi14,
                    },
                    levels: snapshot.market.levels,
                    candidateLevels: snapshot.market.candidateLevels,
                }
                : null,
            scenarios: snapshot.scenarios,
            riskProfileConfigured: snapshot.riskProfileConfigured,
            missingData: snapshot.missingData,
        }),
        "Báo cáo rule tham khảo:",
        JSON.stringify(rulesRaw),
    ].join("\n\n");

    const order = [primary.provider, ...primary.available.filter((n) => n !== primary.provider)].slice(0, 2);
    let parsed = null;
    let model = null;
    for (const name of order) {
        const settings = providerConfig(name);
        if (!settings.key) continue;
        try {
            const text = await callProvider(settings, SYSTEM, prompt, fetchImpl);
            parsed = parseJsonObject(text);
            if (parsed) {
                model = settings.model;
                break;
            }
        } catch (error) {
            console.error("[generateAiReport]", name, error.statusCode || error.name || "fetch");
        }
    }

    if (!parsed) {
        const fallback = validateReport(rulesRaw, { ...snapshot, formulaVersion: FORMULA_VERSION });
        fallback.meta.source = "rules";
        fallback.summary = `${fallback.summary} (AI lỗi — fallback rule)`.trim();
        return fallback;
    }

    parsed.meta = {
        ...(parsed.meta || {}),
        model,
        promptVersion: PROMPT_VERSION,
        formulaVersion: FORMULA_VERSION,
        source: "ai",
    };
    return validateReport(parsed, { ...snapshot, formulaVersion: FORMULA_VERSION });
}

module.exports = {
    generateAiReport,
    buildRulesReport,
    PROMPT_VERSION,
    FORMULA_VERSION,
    SYSTEM,
};
