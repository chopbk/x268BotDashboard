const { httpError } = require("./http");
const { aiSettings, providerConfig, chatRequest, readChatText } = require("./dashboard-brief");
const { collectFactors, ruleSuggestions, COACH_INSTRUCTIONS } = require("./trade-factors");

async function callProvider(settings, system, user, fetchImpl) {
    const request = chatRequest(settings, system, user);
    const res = await fetchImpl(request.url, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: AbortSignal.timeout(12000),
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

function parseSuggestions(text) {
    const raw = String(text || "");
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) throw httpError(502, "AI không trả JSON");
    let parsed;
    try {
        parsed = JSON.parse(raw.slice(start, end + 1));
    } catch {
        throw httpError(502, "AI không trả JSON");
    }
    const list = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
    return list
        .map((item) => {
            const title = String(item?.title || "").replace(/\s+/g, " ").trim().slice(0, 160);
            const detail = String(item?.detail || "").replace(/\s+/g, " ").trim().slice(0, 400);
            if (!title) return null;
            return { title, detail };
        })
        .filter(Boolean)
        .slice(0, 6);
}

function analyzeLocal(row) {
    const factors = collectFactors(row);
    return {
        factors,
        suggestions: ruleSuggestions(factors),
        source: "rules",
        configured: aiSettings().configured,
    };
}

async function askTradeCoach(row, deps = {}) {
    const factors = collectFactors(row);
    const local = ruleSuggestions(factors);
    const primary = aiSettings();
    if (!primary.configured) {
        return {
            factors,
            suggestions: local,
            source: "rules",
            configured: false,
            message: "Chưa cấu hình AI — đang dùng gợi ý rule-based.",
        };
    }
    const fetchImpl = deps.fetch || fetch;
    const prompt = [
        "Hướng dẫn:",
        COACH_INSTRUCTIONS,
        "Yếu tố vị thế:",
        JSON.stringify(factors),
        "Gợi ý rule-based (tham khảo, có thể tinh chỉnh):",
        JSON.stringify(local),
    ].join("\n\n");
    const order = [primary.provider, ...primary.available.filter((name) => name !== primary.provider)].slice(0, 2);
    let text = "";
    for (const name of order) {
        const settings = providerConfig(name);
        if (!settings.key) continue;
        try {
            text = await callProvider(settings, COACH_INSTRUCTIONS, prompt, fetchImpl);
            break;
        } catch (error) {
            console.error("[askTradeCoach]", name, error.statusCode || error.name || "fetch");
        }
    }
    if (!text) {
        return {
            factors,
            suggestions: local,
            source: "rules",
            configured: true,
            message: "AI không trả lời — fallback rule-based.",
        };
    }
    return {
        factors,
        suggestions: parseSuggestions(text),
        source: primary.provider,
        configured: true,
    };
}

module.exports = {
    analyzeLocal,
    askTradeCoach,
    parseSuggestions,
};
