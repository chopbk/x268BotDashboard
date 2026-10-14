const { httpError } = require("./http");
const { listAccountStatics } = require("./account-statics");
const { aiSettings, providerConfig, chatRequest, readChatText } = require("./dashboard-brief");

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_NAMES = {
    january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3,
    april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7,
    august: 8, aug: 8, september: 9, sep: 9, sept: 9,
    october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};

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

function monthRange(year, month, now) {
    const from = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const endExclusive = new Date(year, month, 1, 0, 0, 0, 0);
    const to = now.getTime() < endExclusive.getTime() ? now : new Date(endExclusive.getTime() - 1);
    return { from: from.toISOString(), to: to.toISOString() };
}

function inferPromptFilters(instructions, now = new Date()) {
    const text = String(instructions || "");
    const lower = text.toLowerCase();
    const out = {
        from: "",
        to: "",
        minWin: "",
        minTrades: "",
        clearSymbol: true,
        rangeNote: "",
    };

    const monthNum = lower.match(/th[áa]ng\s*(\d{1,2})(?:\s*(n[àa]y|n[ăa]m\s*(\d{4})))?/i);
    if (monthNum) {
        const month = Number(monthNum[1]);
        if (month >= 1 && month <= 12) {
            let year = now.getFullYear();
            if (monthNum[3]) year = Number(monthNum[3]);
            else if (!monthNum[2] && month > now.getMonth() + 1) year = now.getFullYear() - 1;
            Object.assign(out, monthRange(year, month, now));
            out.rangeNote = `tháng ${month}/${year}`;
        }
    } else {
        const enMonth = lower.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b(?:\s+(\d{4}))?/);
        if (enMonth) {
            const month = MONTH_NAMES[enMonth[1]];
            const year = enMonth[2] ? Number(enMonth[2]) : now.getFullYear();
            Object.assign(out, monthRange(year, month, now));
            out.rangeNote = `${enMonth[1]} ${year}`;
        } else if (/th[áa]ng\s*(n[àa]y|hi[ệe]n\s*t[ạa]i)/i.test(lower)) {
            Object.assign(out, monthRange(now.getFullYear(), now.getMonth() + 1, now));
            out.rangeNote = `tháng ${now.getMonth() + 1}/${now.getFullYear()}`;
        } else if (/h[ôo]m\s*nay|today/i.test(lower)) {
            const from = new Date(now);
            from.setHours(0, 0, 0, 0);
            out.from = from.toISOString();
            out.to = "";
            out.rangeNote = "hôm nay";
        } else {
            const days = lower.match(/(?:trong|g[aầ]n)?\s*(\d{1,3})\s*ng[àa]y/);
            if (days) {
                const n = Number(days[1]);
                if (n >= 1 && n <= 366) {
                    out.from = new Date(now.getTime() - n * DAY_MS).toISOString();
                    out.to = "";
                    out.rangeNote = `${n} ngày gần đây`;
                }
            }
        }
    }

    const win = lower.match(/(?:t[ỉi]\s*l[ệe]\s*th[ắa]ng|win\s*rate|wr)\s*(?:tr[êe]n|≥|>=|>|t[ừu]|t[ừu]\s*)?\s*(\d{1,3})\s*%/)
        || lower.match(/(?:tr[êe]n|≥|>=|>)\s*(\d{1,3})\s*%/);
    if (win) {
        const value = Number(win[1]);
        if (value >= 0 && value <= 100) out.minWin = String(value);
    }

    const trades = lower.match(/(?:≥|>=|>|t[ừu]|[íi]t\s*nh[ấa]t)\s*(\d{1,5})\s*l[ệe]nh/)
        || lower.match(/(\d{1,5})\s*l[ệe]nh/);
    if (trades) {
        const value = Number(trades[1]);
        if (value >= 1 && value <= 10000) out.minTrades = String(value);
    }

    if (/\b([A-Z]{2,15}USDT|[A-Z]{2,15}\/USDT)\b/.test(text) || /symbol|c[ặa]p/i.test(lower)) {
        out.clearSymbol = false;
    }

    return out;
}

function sanitizeSuggestion(raw, knownSignals, inferred = {}) {
    const known = new Set((knownSignals || []).map((name) => String(name || "").toUpperCase()));
    const out = {
        signal: "",
        signals: [],
        minWin: "",
        minTrades: "",
        gain: "",
        side: "",
        profit: "",
        from: "",
        to: "",
        clearSymbol: Boolean(inferred.clearSymbol),
        note: "",
    };
    if (inferred.from) out.from = inferred.from;
    if (Object.prototype.hasOwnProperty.call(inferred, "to") && inferred.to !== undefined) out.to = inferred.to || "";
    if (inferred.minWin) out.minWin = inferred.minWin;
    if (inferred.minTrades) out.minTrades = inferred.minTrades;

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
    const from = String(raw.from || "").trim();
    const to = String(raw.to || "").trim();
    if (from && !Number.isNaN(new Date(from).getTime())) out.from = new Date(from).toISOString();
    if (to && !Number.isNaN(new Date(to).getTime())) out.to = new Date(to).toISOString();
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

    const now = deps.now || new Date();
    const inferred = inferPromptFilters(instructions, now);
    const query = {
        username,
        env: String(body.env || "").trim(),
        book: String(body.book || "live").trim() || "live",
        closed: String(body.closed || "").trim(),
        from: inferred.from || body.from || undefined,
        to: (inferred.from ? (inferred.to || undefined) : (body.to || undefined)),
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
        "Kỳ thời gian đã được server chỉnh theo câu hỏi người dùng nếu có (ví dụ tháng 10). Không bảo thiếu dữ liệu vì kỳ UI cũ.",
        "Trả đúng một JSON object, không markdown:",
        '{"signal":"TEN_SIGNAL_HOAC_RON","signals":["A","B"],"minWin":60,"minTrades":10,"gain":"1","side":"","profit":"","from":"","to":"","note":"giải thích ngắn tiếng Việt"}',
        "signal/signals phải trùng tên trong danh sách. Nếu không chắc, để signal rỗng và chỉ gợi ý minWin/minTrades/note.",
        "gain chỉ dùng \"1\" khi muốn giữ nhóm đang lãi. side chỉ LONG|SHORT hoặc rỗng. profit chỉ win|loss|flat hoặc rỗng.",
        "Nếu bySignal rỗng, nói rõ kỳ đã dùng và gợi ý đổi sổ/user; vẫn điền minWin/minTrades từ yêu cầu nếu có.",
    ].join(" ");

    const userPrompt = [
        `Yêu cầu người dùng: ${instructions}`,
        `User bot: ${username}`,
        `Config đang chọn: ${query.env || "tất cả"}`,
        `Sổ: ${data.book || query.book}`,
        inferred.rangeNote ? `Kỳ suy ra từ câu hỏi: ${inferred.rangeNote}` : "Kỳ theo bộ lọc UI hiện tại",
        `Kỳ openTime dùng để lấy mẫu: ${data.from || query.from || "?"} → ${data.to || query.to || "nay"}`,
        `Tổng lệnh mẫu: ${data.stats?.total || 0}, profit ${data.stats?.profit ?? "—"}, winRate ${data.stats?.winRate ?? "—"}`,
        `Ngưỡng đã suy ra: minWin=${inferred.minWin || "—"}, minTrades=${inferred.minTrades || "—"}`,
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

    const suggestion = sanitizeSuggestion(extractJson(text), signals.map((row) => row.signal), inferred);
    if (!suggestion.note && inferred.rangeNote) {
        suggestion.note = `Đã chỉnh kỳ theo ${inferred.rangeNote}${suggestion.minWin ? `, win rate ≥ ${suggestion.minWin}%` : ""}.`;
    }
    return {
        suggestion,
        provider: primary.provider,
        sample: {
            username,
            book: data.book,
            from: data.from || query.from || null,
            to: data.to || query.to || null,
            total: data.stats?.total || 0,
            signalCount: signals.length,
            rangeNote: inferred.rangeNote || "",
        },
    };
}

module.exports = {
    suggestStaticFilters,
    sanitizeSuggestion,
    extractJson,
    inferPromptFilters,
};
