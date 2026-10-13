const { httpError } = require("./http");
const { aiSettings, providerConfig, chatRequest, readChatText } = require("./dashboard-brief");
const { collectFactors, buildSuggestions, COACH_INSTRUCTIONS } = require("./trade-factors");
const { analyzeMarketStructure } = require("./market-structure");

async function callProvider(settings, system, user, fetchImpl) {
    const request = chatRequest(settings, system, user);
    const res = await fetchImpl(request.url, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: AbortSignal.timeout(20000),
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

function normalizeAction(raw) {
    if (!raw || typeof raw !== "object") return null;
    const type = String(raw.type || "").toLowerCase();
    if (type !== "sl" && type !== "tp" && type !== "both") return null;
    const price = Number(raw.price);
    const sl = Number(raw.sl);
    const tp = Number(raw.tp);
    if (type === "both") {
        if (!(sl > 0) || !(tp > 0)) return null;
        return { type: "both", sl, tp, label: String(raw.label || "SL+TP").slice(0, 80) };
    }
    if (!(price > 0)) return null;
    return {
        type,
        price,
        label: String(raw.label || (type === "sl" ? "Áp SL" : "Áp TP")).slice(0, 80),
        levelId: raw.levelId ? String(raw.levelId).slice(0, 40) : undefined,
    };
}

function parseSuggestions(text, marketLevels = []) {
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
    const allowedPrices = new Set(
        (marketLevels || [])
            .map((l) => Number(l.price))
            .filter((n) => Number.isFinite(n) && n > 0)
            .map((n) => Number(n.toPrecision(10)))
    );
    const list = Array.isArray(parsed?.suggestions) ? parsed.suggestions : [];
    return list
        .map((item) => {
            const title = String(item?.title || "").replace(/\s+/g, " ").trim().slice(0, 160);
            const detail = String(item?.detail || "").replace(/\s+/g, " ").trim().slice(0, 400);
            if (!title) return null;
            let action = normalizeAction(item?.action);
            if (action?.price != null && allowedPrices.size) {
                const key = Number(Number(action.price).toPrecision(10));
                const nearOk = [...allowedPrices].some((p) => Math.abs(p - key) / p < 0.002);
                if (!nearOk && !allowedPrices.has(key)) {
                    // Cho phép SL về entry nếu AI đề xuất — không có trong levels
                    action = { ...action, unverified: true };
                }
            }
            return {
                title,
                detail,
                kind: ["risk", "structure", "level", "market"].includes(item?.kind) ? item.kind : "market",
                action,
            };
        })
        .filter(Boolean)
        .slice(0, 10);
}

async function attachMarket(row, deps = {}) {
    const factors = collectFactors(row);
    if (!factors.symbol) return factors;
    try {
        const market = await analyzeMarketStructure(factors.symbol, {
            side: factors.side,
            entry: factors.entry,
            mark: factors.mark,
            fetchImpl: deps.fetch,
        });
        factors.market = market;
    } catch (error) {
        console.warn("[attachMarket]", factors.symbol, error.message || error);
        factors.market = { error: error.message || "Không lấy được nến" };
    }
    return factors;
}

async function analyzeLocal(row, deps = {}) {
    const factors = await attachMarket(row, deps);
    return {
        factors,
        suggestions: buildSuggestions(factors),
        levels: factors.market?.levels || [],
        source: "rules",
        configured: aiSettings().configured,
    };
}

async function askTradeCoach(row, deps = {}) {
    const factors = await attachMarket(row, deps);
    const local = buildSuggestions(factors);
    const levels = factors.market?.levels || [];
    const primary = aiSettings();
    if (!primary.configured) {
        return {
            factors,
            suggestions: local,
            levels,
            source: "rules",
            configured: false,
            message: "Chưa cấu hình AI — đang dùng gợi ý rule + kỹ thuật.",
        };
    }
    const fetchImpl = deps.fetch || fetch;
    const prompt = [
        "Hướng dẫn:",
        COACH_INSTRUCTIONS,
        "Yếu tố vị thế + market:",
        JSON.stringify(factors),
        "Gợi ý rule/kỹ thuật (tham khảo, có thể tinh chỉnh; giữ action.price khớp market.levels khi đề xuất SL/TP):",
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
            levels,
            source: "rules",
            configured: true,
            message: "AI không trả lời — fallback rule + kỹ thuật.",
        };
    }
    const aiItems = parseSuggestions(text, levels);
    // Ghép levels kỹ thuật chưa có action vào sau AI nếu AI bỏ sót
    const hasActionPrice = new Set(
        aiItems.filter((i) => i.action?.price).map((i) => Number(Number(i.action.price).toPrecision(10)))
    );
    const fill = local.filter((i) => {
        if (!i.action?.price) return false;
        const key = Number(Number(i.action.price).toPrecision(10));
        return !hasActionPrice.has(key);
    }).slice(0, 4);
    return {
        factors,
        suggestions: [...aiItems, ...fill].slice(0, 12),
        levels,
        source: primary.provider,
        configured: true,
    };
}

module.exports = {
    analyzeLocal,
    askTradeCoach,
    parseSuggestions,
    attachMarket,
    normalizeAction,
};
