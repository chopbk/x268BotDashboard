const { aiSettings, providerConfig, chatRequest, readChatText } = require("../dashboard-brief");
const { validateReport } = require("./validate-report");
const { buildTechnicalBrief } = require("./market-snapshot");

const PROMPT_VERSION = "decision-v1.2";
const FORMULA_VERSION = "decision-v1";

const SYSTEM = [
    "Bạn là chuyên gia quản trị rủi ro futures — viết báo cáo ngắn cho trader.",
    "Chỉ giải thích số liệu đã có trong snapshot. Không bịa giá/mức ngoài scenarios, market.levels, metrics, technicalBrief.",
    "Phase 1 chỉ đọc: không bảo hệ thống tự đặt lệnh; có thể gợi ý việc trader nên cân nhắc.",
    "",
    "Nội dung bắt buộc khi có market/technicalBrief (phân tích symbol):",
    "- summary phải nhắc ngắn cấu trúc/xu hướng symbol (không chỉ PnL/SL).",
    "- findings phải có ít nhất 2 mục kỹ thuật: cấu trúc đa khung, khớp hướng lệnh,",
    "  và nếu có thì RSI/ATR hoặc vùng hỗ trợ–kháng cự (diễn đạt lại technicalBrief, không bịa).",
    "- Có thể giữ findings rủi ro lệnh (thiếu SL, gần liq…) sau phần kỹ thuật.",
    "",
    "Văn phong (bắt buộc):",
    "- Tiếng Việt tự nhiên, dễ hiểu, chuyên nghiệp; tránh jargon chồng chất (multiTf, alignment, mark→SL…).",
    "- Nếu dùng thuật ngữ kỹ thuật, giải thích ngắn trong ngoặc hoặc bằng lời thường.",
    "- Câu ngắn, chủ động; không sáo rỗng (“cần theo dõi sát sao”, “thị trường biến động”).",
    "- summary: 1–2 câu, nêu tình trạng kỹ thuật + việc ưu tiên nhất.",
    "- findings.title: ngắn như tiêu đề tin (≤8 từ). detail: 1–2 câu nói rõ vì sao quan trọng.",
    "- priorities.action: động từ + việc cụ thể. why/impact: 1 cụm ngắn, không lặp summary.",
    "- scenarios: giữ nguyên id từ snapshot; chỉ viết lại title/rationale/invalidation cho dễ đọc;",
    "  không đổi candidateLevels, qtyImpact, số PnL/R:R đã tính.",
    "- Không emoji, không markdown trong JSON, không liệt kê dài.",
    "",
    "Schema JSON: summary, riskLevel (normal|attention|high|insufficient_data),",
    "findings[{title,detail,evidence,severity}], scenarios[{id,title,rationale,conditions,candidateLevels,qtyImpact,pnlEstimates,riskFromMarkToSl,rrRemaining,accountBudgetImpact,invalidation}],",
    "priorities[{action,why,impact}], missingData[], invalidationConditions[].",
    "Giữ scenarios.id khớp snapshot (hold_manage|reduce_risk|exit_invalidation|…).",
    "Nếu missingData có risk_profile: nhắc chưa có ngân sách rủi ro cá nhân — không tự bịa ngưỡng.",
].join(" ");

function fmtNum(value, digits = 2) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Number(n.toFixed(digits));
}

function moneyish(value) {
    const n = fmtNum(value, 2);
    if (n == null) return null;
    return `${n}`;
}

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
    const sideLabel = metrics.side === "LONG" ? "Long" : metrics.side === "SHORT" ? "Short" : "";

    const technical = snapshot.scope === "position"
        ? (snapshot.technicalBrief || buildTechnicalBrief(snapshot.market, {
            side: metrics.side,
            symbol: metrics.symbol || snapshot.symbol,
        }))
        : null;
    if (technical?.findings?.length) {
        findings.push(...technical.findings);
    }

    if (snapshot.scope === "position") {
        if (metrics.sl == null) {
            findings.push({
                title: "Chưa có stop-loss trên sàn",
                detail: "Lệnh đang mở mà không có mức cắt lỗ — rủi ro không bị giới hạn.",
                evidence: "exchange_sl null",
                severity: "critical",
            });
        }
        if (metrics.liqDistancePct != null && metrics.liqDistancePct < 5) {
            findings.push({
                title: "Gần mức thanh lý",
                detail: `Giá hiện tại chỉ còn khoảng ${fmtNum(metrics.liqDistancePct, 1)}% tới thanh lý.`,
                evidence: `liq=${metrics.liquidation}`,
                severity: "critical",
            });
        }
        if (metrics.rrRemaining != null && metrics.rrRemaining < 1) {
            findings.push({
                title: "Tỷ lệ lời/rủi ro còn lại thấp",
                detail: `Phần thưởng tới take-profit chưa bù đủ rủi ro tới stop-loss (≈ ${fmtNum(metrics.rrRemaining, 2)}R).`,
                evidence: `riskMarkToSl=${metrics.riskMarkToSl}, rewardMarkToTp=${metrics.rewardMarkToTp}`,
                severity: "warn",
            });
        }
    } else if (account) {
        if (account.missingSlCount > 0) {
            findings.push({
                title: "Một số lệnh chưa có stop-loss",
                detail: `${account.missingSlCount} vị thế đang mở chưa gắn cắt lỗ trên sàn.`,
                evidence: JSON.stringify(account.missingSl?.slice(0, 5) || []),
                severity: account.missingSlCount >= 2 ? "critical" : "warn",
            });
        }
        for (const b of account.profileBreaches || []) {
            findings.push({
                title: "Vượt giới hạn hồ sơ rủi ro",
                detail: b.detail,
                evidence: b.code,
                severity: "warn",
            });
        }
        if (account.exposurePct != null && account.exposurePct > 300) {
            findings.push({
                title: "Đòn bẩy danh mục cao",
                detail: `Tổng giá trị vị thế khoảng ${fmtNum(account.exposurePct, 0)}% so với vốn — biến động giá sẽ khuếch đại mạnh.`,
                evidence: `grossNotional=${account.grossNotional}`,
                severity: "warn",
            });
        }
    }

    if (missing.includes("risk_profile")) {
        findings.push({
            title: "Chưa có ngân sách rủi ro cá nhân",
            detail: "Chưa khai báo hạn mức lỗ/ngày hay phong cách — báo cáo không tự đặt ngưỡng thay bạn.",
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

    let summary = "Chưa đủ dữ liệu để đánh giá.";
    if (snapshot.scope === "position") {
        const head = `${metrics.symbol || "Vị thế"} ${sideLabel}`.trim();
        const techBit = technical?.cards
            ? ` Thị trường: ${technical.cards.multiTfLabel}, ${technical.cards.alignmentLabel}.`
            : "";
        const pnl = moneyish(metrics.unrealized);
        if (metrics.sl == null) {
            summary = `${head}: chưa có stop-loss — ưu tiên giới hạn rủi ro trước khi giữ thêm.${techBit}`;
        } else if (metrics.liqDistancePct != null && metrics.liqDistancePct < 5) {
            summary = `${head}: sát thanh lý (~${fmtNum(metrics.liqDistancePct, 1)}%) — cần giảm rủi ro ngay.${techBit}`;
        } else if (metrics.riskMarkToSl != null) {
            const pnlBit = pnl != null ? ` PnL tạm ${pnl}.` : "";
            summary = `${head}: rủi ro từ giá hiện tại tới stop-loss khoảng ${moneyish(metrics.riskMarkToSl)}.${pnlBit}${techBit}`;
        } else {
            summary = `${head}: đã có dữ liệu cơ bản; kiểm tra stop-loss và kế hoạch thoát.${techBit}`;
        }
    } else if (account) {
        const n = account.positionCount ?? 0;
        if (account.missingSlCount > 0) {
            summary = `Tài khoản ${snapshot.account || ""}: ${n} vị thế, ${account.missingSlCount} chưa có stop-loss — ưu tiên phủ cắt lỗ.`.replace(/\s+/g, " ").trim();
        } else if (account.exposurePct != null && account.exposurePct > 300) {
            summary = `Tài khoản ${snapshot.account || ""}: đòn bẩy danh mục ~${fmtNum(account.exposurePct, 0)}% vốn — cân nhắc giảm quy mô.`.replace(/\s+/g, " ").trim();
        } else {
            summary = `Tài khoản ${snapshot.account || ""}: ${n} vị thế đang mở; chưa thấy cảnh báo nặng từ dữ liệu hiện có.`.replace(/\s+/g, " ").trim();
        }
    }
    if (missing.includes("risk_profile") && !/ngân sách rủi ro/i.test(summary)) {
        summary = `${summary} Chưa có ngân sách rủi ro cá nhân.`;
    }

    return {
        summary,
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
                    btc1h: snapshot.market.btc1h
                        ? {
                            structure: snapshot.market.btc1h.structure,
                            trendVsEma: snapshot.market.btc1h.trendVsEma,
                            rsi14: snapshot.market.btc1h.rsi14,
                        }
                        : null,
                    levels: snapshot.market.levels,
                    candidateLevels: snapshot.market.candidateLevels,
                }
                : null,
            technicalBrief: snapshot.technicalBrief || null,
            scenarios: snapshot.scenarios,
            riskProfileConfigured: snapshot.riskProfileConfigured,
            missingData: snapshot.missingData,
        }),
        "Báo cáo rule tham khảo (giữ số liệu; viết lại cho gọn và dễ đọc hơn nếu cần):",
        JSON.stringify(rulesRaw),
        "Yêu cầu thêm: summary + findings phải có phần phân tích kỹ thuật symbol; priorities nghe như lời tư vấn ngắn, không như log hệ thống.",
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
        fallback.summary = `${fallback.summary} (Dùng bản phân tích rule vì AI tạm không phản hồi.)`.trim();
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
