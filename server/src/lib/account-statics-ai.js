const { httpError } = require("./http");
const { listAccountStatics } = require("./account-statics");
const { aiSettings, providerConfig, chatRequest, readChatText } = require("./dashboard-brief");

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

function extractJson(text) {
    const raw = String(text || "").trim();
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const body = fenced ? fenced[1].trim() : raw;
    const start = body.indexOf("{");
    const end = body.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
        return JSON.parse(body.slice(start, end + 1));
    } catch {
        return null;
    }
}

function sanitizeSuggestion(raw, knownSignals) {
    const known = new Set((knownSignals || []).map((name) => String(name || "").toUpperCase()));
    const out = {
        signal: "",
        signals: [],
        minWin: "",
        minTrades: "",
        gain: "",
        side: "",
        profit: "",
        note: "",
    };
    if (!raw || typeof raw !== "object") return out;
    const signal = String(raw.signal || "").trim().toUpperCase();
    if (signal && known.has(signal)) out.signal = signal;
    const list = Array.isArray(raw.signals) ? raw.signals : [];
    out.signals = list
        .map((name) => String(name || "").trim().toUpperCase())
        .filter((name) => known.has(name))
        .slice(0, 8);
    if (!out.signal && out.signals[0]) out.signal = out.signals[0];
    const minWin = Number(raw.minWin);
    if (Number.isFinite(minWin) && minWin >= 0 && minWin <= 100) out.minWin = String(Math.round(minWin));
    const minTrades = Number(raw.minTrades);
    if (Number.isFinite(minTrades) && minTrades >= 1 && minTrades <= 10000) out.minTrades = String(Math.round(minTrades));
    if (raw.gain === true || raw.gain === "1" || raw.gain === 1) out.gain = "1";
    const side = String(raw.side || "").trim().toUpperCase();
    if (side === "LONG" || side === "SHORT") out.side = side;
    const profit = String(raw.profit || "").trim().toLowerCase();
    if (profit === "win" || profit === "loss" || profit === "flat") out.profit = profit;
    out.note = String(raw.note || raw.reason || "").trim().slice(0, 600);
    return out;
}

async function suggestStaticFilters(actor, body = {}, deps = {}) {
    const username = String(body.username || "").trim();
    if (!username) throw httpError(400, "Thiếu user bot");
    const instructions = String(body.instructions || "").trim().slice(0, 2000);
    if (!instructions) throw httpError(400, "Nhập câu hỏi hoặc tiêu chí tìm signal");

    const primary = aiSettings();
    if (!primary.configured) {
        throw httpError(400, "Chưa cấu hình AI_PROVIDER và API key của Gemini, OpenAI, DeepSeek hoặc Claude");
    }

    const query = {
        username,
        env: String(body.env || "").trim(),
        book: String(body.book || "live").trim() || "live",
        closed: String(body.closed || "").trim(),
        from: body.from || undefined,
        to: body.to || undefined,
        page: 1,
        limit: 10,
    };
    const data = await listAccountStatics(actor, query);
    const signals = (data.stats?.bySignal || []).slice(0, 40).map((row) => ({
        signal: row.signal,
        count: row.count,
        wins: row.wins,
        losses: row.losses,
        winRate: row.winRate == null ? null : Number(Number(row.winRate).toFixed(1)),
        profit: row.profit == null ? null : Number(Number(row.profit).toFixed(2)),
        volume: row.volume == null ? null : Number(Number(row.volume).toFixed(2)),
        avgRoi: row.avgRoi == null ? null : Number(Number(row.avgRoi).toFixed(1)),
    }));
    const configs = (data.stats?.byConfig || data.stats?.byEnv || []).slice(0, 20).map((row) => ({
        env: row.env,
        count: row.count,
        winRate: row.winRate == null ? null : Number(Number(row.winRate).toFixed(1)),
        profit: row.profit == null ? null : Number(Number(row.profit).toFixed(2)),
    }));

    const system = [
        "Bạn là trợ lý lọc Account Static của web-bot.",
        "Chỉ dùng số liệu JSON được cung cấp. Không bịa signal hoặc số liệu.",
        "Trả đúng một JSON object, không markdown:",
        '{"signal":"TEN_SIGNAL_HOAC_RON","signals":["A","B"],"minWin":60,"minTrades":10,"gain":"1","side":"","profit":"","note":"giải thích ngắn tiếng Việt"}',
        "signal/signals phải trùng tên trong danh sách. Nếu không chắc, để signal rỗng và chỉ gợi ý minWin/minTrades/note.",
        "gain chỉ dùng \"1\" khi muốn giữ nhóm đang lãi. side chỉ LONG|SHORT hoặc rỗng. profit chỉ win|loss|flat hoặc rỗng.",
    ].join(" ");

    const userPrompt = [
        `Yêu cầu người dùng: ${instructions}`,
        `User bot: ${username}`,
        `Config đang chọn: ${query.env || "tất cả"}`,
        `Sổ: ${data.book || query.book}`,
        `Kỳ openTime: ${data.from || "?"} → ${data.to || "nay"}`,
        `Tổng lệnh mẫu: ${data.stats?.total || 0}, profit ${data.stats?.profit ?? "—"}, winRate ${data.stats?.winRate ?? "—"}`,
        `bySignal: ${JSON.stringify(signals)}`,
        `byConfig: ${JSON.stringify(configs)}`,
    ].join("\n");

    const order = [primary.provider, ...primary.available.filter((name) => name !== primary.provider)].slice(0, 2);
    const fetchImpl = deps.fetch || fetch;
    let text = "";
    for (const name of order) {
        const settings = providerConfig(name);
        if (!settings.key) continue;
        try {
            text = await callProvider(settings, system, userPrompt, fetchImpl);
            break;
        } catch (error) {
            console.error("[suggestStaticFilters]", name, error.statusCode || error.name || "fetch");
        }
    }
    if (!text) throw httpError(502, "Không gọi được AI");

    const suggestion = sanitizeSuggestion(extractJson(text), signals.map((row) => row.signal));
    return {
        suggestion,
        provider: primary.provider,
        sample: {
            username,
            book: data.book,
            from: data.from,
            to: data.to,
            total: data.stats?.total || 0,
            signalCount: signals.length,
        },
    };
}

module.exports = { suggestStaticFilters, sanitizeSuggestion, extractJson };
