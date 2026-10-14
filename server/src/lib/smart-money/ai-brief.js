/**
 * AI kết luận Smart Money — tổng quan thị trường + chi tiết 1 symbol.
 * Chỉ diễn giải snapshot/candidates đã có; không gọi sàn; không bịa trader/xác suất.
 */
const { httpError } = require("../http");
const { aiSettings, providerConfig, chatRequest, readChatText } = require("../dashboard-brief");
const { listSymbolsQuery, getSymbolDetail, getStatusPayload } = require("./read-api");
const { getCandidates } = require("./candidates");

const PROMPT_VERSION = "sm-ai-v1";

const SYSTEM_COMMON = [
    "Bạn là chuyên gia đọc dòng tiền futures (Smart Money / OI / funding / taker).",
    "Chỉ dùng số liệu trong JSON người dùng gửi. Không bịa giá, trader, nguồn tiền, xác suất thắng.",
    "Field null/missing → nói thiếu dữ liệu, vẫn kết luận phần còn lại.",
    "Không khuyến nghị tự động đặt lệnh; có thể gợi ý việc trader nên cân nhắc.",
    "Tiếng Việt ngắn gọn, chuyên nghiệp; không emoji; không markdown trong JSON.",
    "Trả đúng 1 object JSON với các field được yêu cầu.",
].join(" ");

async function callProvider(settings, system, user, fetchImpl) {
    const request = chatRequest(settings, system, user);
    const res = await fetchImpl(request.url, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(request.body),
        signal: AbortSignal.timeout(28_000),
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

async function askWithFallback(system, user, deps = {}) {
    const primary = aiSettings();
    if (!primary.configured) {
        throw httpError(400, "Chưa cấu hình AI_PROVIDER và API key của Gemini, OpenAI, DeepSeek hoặc Claude");
    }
    const order = [primary.provider, ...primary.available.filter((name) => name !== primary.provider)].slice(0, 2);
    const fetchImpl = deps.fetch || fetch;
    let text = "";
    let used = primary.provider;
    for (const name of order) {
        const settings = providerConfig(name);
        if (!settings.key) continue;
        try {
            text = await callProvider(settings, system, user, fetchImpl);
            used = name;
            break;
        } catch (error) {
            console.error("[smartMoneyAi]", name, error.statusCode || error.name || "fetch");
        }
    }
    if (!text) throw httpError(502, "Không gọi được AI");
    return { text, provider: used };
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

function clampStr(value, max) {
    const s = String(value || "").trim();
    if (!s) return "";
    return s.length > max ? s.slice(0, max) : s;
}

function normalizeBrief(parsed, rawText, { mode }) {
    const stanceRaw = String(parsed?.stance || "").toLowerCase();
    const stanceOk = ["risk_on", "risk_off", "mixed", "unclear", "long", "short", "both"].includes(stanceRaw)
        ? stanceRaw
        : "unclear";
    const bullets = Array.isArray(parsed?.bullets)
        ? parsed.bullets.map((b) => clampStr(b, 220)).filter(Boolean).slice(0, 6)
        : [];
    const watch = Array.isArray(parsed?.watch)
        ? parsed.watch.map((b) => clampStr(b, 80)).filter(Boolean).slice(0, 8)
        : [];
    const risks = Array.isArray(parsed?.risks)
        ? parsed.risks.map((b) => clampStr(b, 220)).filter(Boolean).slice(0, 4)
        : [];
    return {
        mode,
        headline: clampStr(parsed?.headline, 160) || (mode === "overview" ? "Tổng quan thị trường" : "Kết luận symbol"),
        stance: stanceOk,
        summary: clampStr(parsed?.summary, 900) || clampStr(rawText, 900) || "AI không trả về nội dung hợp lệ.",
        bullets,
        watch,
        risks,
        promptVersion: PROMPT_VERSION,
    };
}

function compactRow(row) {
    return {
        symbol: row.symbol,
        mark: row.price?.mark ?? null,
        changePct24h: row.price?.changePct24h ?? null,
        quoteVolume24h: row.price?.quoteVolume24h ?? null,
        oiDeltaPct: row.openInterest?.deltaPct ?? null,
        smStatus: row.smartMoney?.status ?? null,
        tradersLongQty: row.smartMoney?.tradersLongQty ?? null,
        tradersShortQty: row.smartMoney?.tradersShortQty ?? null,
        whalesLongQty: row.smartMoney?.whalesLongQty ?? null,
        whalesShortQty: row.smartMoney?.whalesShortQty ?? null,
        whalesLongDelta: row.smartMoney?.whalesLongDelta ?? null,
        comparable: row.smartMoney?.comparable ?? null,
        taker: row.taker?.buySellRatio ?? null,
        funding: row.funding?.currentRate ?? null,
        bias: row.derived?.bias ?? null,
        whaleBias: row.derived?.whaleBias ?? null,
        quality: row.quality?.overall ?? null,
    };
}

function compactSnapshot(snap) {
    if (!snap) return null;
    return {
        symbol: snap.symbol,
        collectedAt: snap.collectedAt,
        quality: snap.quality?.overall ?? null,
        missing: snap.quality?.missing || [],
        price: {
            mark: snap.price?.mark ?? null,
            changePct24h: snap.price?.changePct24h ?? null,
        },
        openInterest: {
            qty: snap.openInterest?.qty ?? null,
            deltaPct: snap.openInterest?.deltaPct ?? null,
            status: snap.openInterest?.status ?? null,
        },
        funding: {
            currentRate: snap.funding?.currentRate ?? null,
            intervalHours: snap.funding?.intervalHours ?? null,
            status: snap.funding?.status ?? null,
        },
        topTrader: {
            accountLsr: snap.topTrader?.accountLsr ?? null,
            positionLsr: snap.topTrader?.positionLsr ?? null,
            status: snap.topTrader?.status ?? null,
        },
        taker: {
            buySellRatio: snap.taker?.buySellRatio ?? null,
            status: snap.taker?.status ?? null,
        },
        smartMoney: {
            status: snap.smartMoney?.status ?? null,
            comparable: snap.smartMoney?.comparable ?? null,
            cohortId: snap.smartMoney?.cohortId ?? null,
            traders: snap.smartMoney?.traders || null,
            whales: snap.smartMoney?.whales || null,
        },
        derived: {
            bias: snap.derived?.bias ?? null,
            whaleBias: snap.derived?.whaleBias ?? null,
            deltas: snap.derived?.deltas || null,
            distanceToWhaleEntryPct: snap.derived?.distanceToWhaleEntryPct || null,
            distanceToTraderEntryPct: snap.derived?.distanceToTraderEntryPct || null,
        },
    };
}

async function buildOverviewFacts(query = {}) {
    const top = Math.min(30, Math.max(1, Number(query.top) || 10));
    const [status, list, candidates] = await Promise.all([
        getStatusPayload(),
        listSymbolsQuery({ top: String(top) }),
        getCandidates().catch(() => ({ items: [] })),
    ]);
    const rows = (list.rows || []).map(compactRow);
    const candItems = (candidates.items || []).slice(0, 12).map((i) => ({
        symbol: i.symbol,
        bucket: i.bucket,
        score: i.score,
        reasons: (i.reasons || []).slice(0, 3),
        risks: (i.risks || []).slice(0, 2),
    }));
    return {
        asOf: new Date().toISOString(),
        universe: {
            size: status?.universe?.size ?? rows.length,
            withSnapshot: status?.universe?.withSnapshot ?? null,
            warming: Boolean(status?.warming),
            bapiCooldownMs: status?.cooldowns?.bapiMs ?? 0,
        },
        rows,
        candidates: candItems,
        note: "Ứng viên chỉ là gợi ý xem xét — không phải lệnh chắc thắng.",
    };
}

async function buildSymbolFacts(symbolRaw) {
    const detail = await getSymbolDetail(symbolRaw);
    if (detail.error) {
        const err = httpError(detail.status || 400, detail.error);
        throw err;
    }
    return {
        asOf: new Date().toISOString(),
        symbol: detail.symbol || String(symbolRaw || "").toUpperCase(),
        warming: Boolean(detail.warming),
        tracking: detail.tracking || null,
        snapshot: compactSnapshot(detail.snapshot),
        events: (detail.events || []).slice(0, 8).map((e) => ({
            type: e.type,
            direction: e.direction,
            zScore: e.zScore,
            at: e.at,
            message: e.message,
            smallSample: Boolean(e.smallSample),
        })),
    };
}

async function askOverview(body = {}, deps = {}) {
    const extra = clampStr(body.instructions, 800);
    const facts = await buildOverviewFacts({ top: body.top });
    if (!facts.rows.length) {
        throw httpError(400, "Chưa có snapshot Smart Money để phân tích");
    }
    const system = [
        SYSTEM_COMMON,
        "Nhiệm vụ: kết luận TỔNG QUAN thị trường từ danh sách symbol đang theo dõi.",
        "Schema JSON: headline (≤12 từ), stance (risk_on|risk_off|mixed|unclear),",
        "summary (2–4 câu), bullets[3–5 câu ngắn], watch[symbol đáng xem], risks[0–3].",
        "Ưu tiên mâu thuẫn bias/whale, OI bất thường, funding cực đoan, thiếu dữ liệu SM.",
    ].join(" ");
    const user = JSON.stringify({
        task: "smart_money_market_overview",
        instructions: extra || null,
        facts,
    });
    const { text, provider } = await askWithFallback(system, user, deps);
    const parsed = extractJson(text);
    return {
        ...normalizeBrief(parsed || {}, text, { mode: "overview" }),
        provider,
        generatedAt: new Date().toISOString(),
        coverage: {
            symbols: facts.rows.length,
            withSmOk: facts.rows.filter((r) => r.smStatus === "ok").length,
        },
    };
}

async function askSymbol(body = {}, deps = {}) {
    const symbol = String(body.symbol || "").trim().toUpperCase();
    if (!/^[A-Z0-9]{4,25}$/.test(symbol)) throw httpError(400, "symbol_invalid");
    const extra = clampStr(body.instructions, 800);
    const facts = await buildSymbolFacts(symbol);
    if (!facts.snapshot) {
        throw httpError(400, "Chưa có snapshot cho symbol này");
    }
    const system = [
        SYSTEM_COMMON,
        "Nhiệm vụ: kết luận CHI TIẾT cho đúng 1 symbol.",
        "Schema JSON: headline (≤12 từ), stance (long|short|both|unclear),",
        "summary (2–4 câu), bullets[3–5], risks[0–3], watch[] để trống hoặc 1 symbol.",
        "Nhấn mạnh: bias vs whaleBias, OI/funding/taker đồng thuận hay mâu thuẫn,",
        "khoảng cách giá tới avg entry (nếu có), cohort không comparable thì không suy delta.",
    ].join(" ");
    const user = JSON.stringify({
        task: "smart_money_symbol_brief",
        instructions: extra || null,
        facts,
    });
    const { text, provider } = await askWithFallback(system, user, deps);
    const parsed = extractJson(text);
    return {
        ...normalizeBrief(parsed || {}, text, { mode: "symbol" }),
        symbol,
        provider,
        generatedAt: new Date().toISOString(),
    };
}

module.exports = {
    PROMPT_VERSION,
    askOverview,
    askSymbol,
    extractJson,
    normalizeBrief,
    compactRow,
    compactSnapshot,
};
