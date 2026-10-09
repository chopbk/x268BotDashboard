const { httpError } = require("./http");
const { getDashboard } = require("./dashboard");
const { aiSettings, providerConfig, attentionPackage, parseAiItems, chatRequest, readChatText } = require("./dashboard-brief");

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

async function askAttention(actor, body = {}, deps = {}) {
    const view = await getDashboard(actor);
    const facts = view?.ai?.data || {};
    const extra = String(body?.instructions || "").slice(0, 2000);
    const pack = attentionPackage(facts, extra);
    const primary = aiSettings();
    if (!primary.configured) {
        throw httpError(400, "Chưa cấu hình AI_PROVIDER và API key của Gemini, OpenAI, DeepSeek hoặc Claude");
    }
    const order = [primary.provider, ...primary.available.filter((name) => name !== primary.provider)].slice(0, 2);
    const fetchImpl = deps.fetch || fetch;
    const system = `${pack.instructions}\nKhông nhắc lỗi parse. Không bịa số. href chỉ được lấy từ dữ liệu.`;
    let text = "";
    for (const name of order) {
        const settings = providerConfig(name);
        if (!settings.key) continue;
        try {
            text = await callProvider(settings, system, pack.prompt, fetchImpl);
            break;
        } catch (error) {
            console.error("[askAttention]", name, error.statusCode || error.name || "fetch");
        }
    }
    if (!text) throw httpError(502, "Không gọi được AI");
    return { items: parseAiItems(text, facts), provider: primary.provider };
}

module.exports = { askAttention };
