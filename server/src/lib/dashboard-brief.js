const { httpError } = require("./http");

const INSTRUCTIONS = [
    "Viết tiếng Việt, tối đa 8 việc, mỗi việc một câu.",
    "Ưu tiên user nào, config nào, signal nào đang lỗ nhiều hôm nay. Ghi số tiền và số lệnh đúng như dữ liệu.",
    "Nếu ví income của user âm, nhắc tên user, số lỗ, và signal nào đang lỗ. Không có signal live lỗ thì nói cần xem income của tài khoản.",
    "Config đang bật nhưng chưa có signal chỉ nêu khi không có khoản lỗ lớn hơn.",
    "Không nhắc lỗi parse.",
    "Không bịa số, user, signal hay link.",
    "Trả về JSON {\"items\":[{\"title\":\"...\",\"href\":\"...\"}]} và không thêm chữ ngoài JSON.",
].join(" ");

const DEEPSEEK_MODELS = {
    "deepseek-chat": "deepseek-v4-flash",
    "deepseek-reasoner": "deepseek-v4-flash",
};

function envText(name) {
    return String(process.env[name] || "").trim();
}

function resolveDeepSeekModel(model) {
    return DEEPSEEK_MODELS[model] || model;
}

function providerConfig(name) {
    const provider = name === "openai" || name === "deepseek" || name === "claude" ? name : "gemini";
    if (provider === "openai") {
        return {
            provider,
            key: envText("OPENAI_API_KEY"),
            model: envText("AI_MODEL") || "gpt-4o-mini",
            base: (envText("OPENAI_BASE_URL") || "https://api.openai.com/v1").replace(/\/$/, ""),
        };
    }
    if (provider === "deepseek") {
        const requested = envText("AI_MODEL") || envText("DEEPSEEK_MODEL") || "deepseek-v4-flash";
        return {
            provider,
            key: envText("DEEPSEEK_API_KEY"),
            model: resolveDeepSeekModel(requested),
            base: (envText("DEEPSEEK_BASE_URL") || "https://api.deepseek.com").replace(/\/$/, ""),
        };
    }
    if (provider === "claude") {
        return {
            provider,
            key: envText("ANTHROPIC_API_KEY") || envText("CLAUDE_API_KEY"),
            model: envText("AI_MODEL") || "claude-sonnet-4-6",
            base: (envText("ANTHROPIC_BASE_URL") || "https://api.anthropic.com/v1").replace(/\/$/, ""),
        };
    }
    return {
        provider: "gemini",
        key: envText("GEMINI_API_KEY"),
        model: envText("AI_MODEL") || "gemini-2.0-flash",
        base: "https://generativelanguage.googleapis.com/v1beta",
    };
}

function availableProviders() {
    return ["openai", "deepseek", "claude", "gemini"].filter((name) => providerConfig(name).key);
}

function aiSettings() {
    const requestedName = envText("AI_PROVIDER").toLowerCase();
    const requested = providerConfig(requestedName || "gemini");
    const available = availableProviders();
    const current = requested.key ? requested : providerConfig(available[0] || requested.provider);
    return { ...current, configured: Boolean(current.key), available };
}

function chatRequest(settings, system, user) {
    if (settings.provider === "gemini") {
        return {
            url: `${settings.base}/models/${encodeURIComponent(settings.model)}:generateContent`,
            headers: { "Content-Type": "application/json", "x-goog-api-key": settings.key },
            body: {
                contents: [{ role: "user", parts: [{ text: `${system}\n\n${user}` }] }],
                generationConfig: { temperature: 0.2, maxOutputTokens: 1200, topP: 0.95 },
            },
        };
    }
    if (settings.provider === "claude") {
        return {
            url: `${settings.base}/messages`,
            headers: {
                "Content-Type": "application/json",
                "x-api-key": settings.key,
                "anthropic-version": "2023-06-01",
            },
            body: {
                model: settings.model,
                max_tokens: 1200,
                temperature: 0.2,
                system,
                messages: [{ role: "user", content: user }],
            },
        };
    }
    const body = {
        model: settings.model,
        temperature: 0.2,
        max_tokens: 1200,
        messages: [
            { role: "system", content: system },
            { role: "user", content: user },
        ],
    };
    if (settings.provider === "deepseek") {
        const thinking = envText("DEEPSEEK_THINKING") === "enabled" || envText("AI_MODEL") === "deepseek-reasoner"
            ? "enabled"
            : "disabled";
        body.thinking = { type: thinking };
    }
    return {
        url: `${settings.base}/chat/completions`,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.key}` },
        body,
    };
}

function readChatText(provider, payload) {
    if (provider === "gemini") {
        const parts = payload?.candidates?.[0]?.content?.parts || [];
        return parts.map((part) => part?.text || "").join("").trim();
    }
    if (provider === "claude") return String(payload?.content?.[0]?.text || "").trim();
    return String(payload?.choices?.[0]?.message?.content || "").trim();
}

function attentionPackage(facts, extra = "") {
    const note = String(extra || "").trim().slice(0, 2000);
    const prompt = [
        "Hướng dẫn:",
        INSTRUCTIONS,
        note ? `Hướng dẫn thêm:\n${note}` : "",
        "Dữ liệu:",
        JSON.stringify(facts || {}),
    ].filter(Boolean).join("\n\n");
    const settings = aiSettings();
    return {
        configured: settings.configured,
        provider: settings.provider,
        model: settings.model,
        instructions: INSTRUCTIONS,
        data: facts || {},
        prompt,
    };
}

function collectHrefs(value, out = new Set()) {
    if (!value || typeof value !== "object") return out;
    if (Array.isArray(value)) {
        for (const item of value) collectHrefs(item, out);
        return out;
    }
    if (typeof value.href === "string" && value.href.startsWith("/")) out.add(value.href);
    for (const item of Object.values(value)) {
        if (item && typeof item === "object") collectHrefs(item, out);
    }
    return out;
}

function parseAiItems(text, facts) {
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
    const allowed = collectHrefs(facts);
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    return items
        .map((item) => {
            const title = String(item?.title || "").replace(/\s+/g, " ").trim().slice(0, 240);
            const href = String(item?.href || "").trim();
            if (!title || /lỗi parse/i.test(title)) return null;
            if (!allowed.has(href)) return null;
            return { type: "ai", title, href };
        })
        .filter(Boolean)
        .slice(0, 8);
}

module.exports = {
    INSTRUCTIONS,
    aiSettings,
    providerConfig,
    chatRequest,
    readChatText,
    attentionPackage,
    collectHrefs,
    parseAiItems,
};
