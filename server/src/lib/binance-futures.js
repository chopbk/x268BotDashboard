const crypto = require("crypto");
const { httpError } = require("./http");
const { binancePublicFetch } = require("./binance-peer-proxy");

const HOST = "https://fapi.binance.com";
const QUOTE = new Set(["USDT", "BUSD", "USDC", "FDUSD", "BFUSD"]);

function toNum(value) {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : 0;
}

function signQuery(secret, params) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value != null && value !== "") query.set(key, String(value));
    }
    query.set("recvWindow", "5000");
    query.set("timestamp", String(Date.now()));
    const payload = query.toString();
    const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
    return `${payload}&signature=${signature}`;
}

function binanceError(status, body) {
    const code = body && body.code;
    const msg = body?.msg ? String(body.msg) : "";
    if (status === 418 || status === 429 || code === -1003 || code === -1015) {
        return httpError(429, msg || "Sàn đang giới hạn tần suất, thử lại sau");
    }
    if (code === -2015 || code === -2014 || status === 401) {
        return httpError(400, msg ? `API key không gọi được futures: ${msg}` : "API key không gọi được futures");
    }
    if (msg || code != null) {
        const label = code != null ? `[${code}] ${msg || "Binance lỗi"}` : msg;
        console.error("[binanceFutures]", status, label);
        return httpError(status >= 400 && status < 500 ? status : 400, label);
    }
    console.error("[binanceFutures]", status, "empty body / non-json");
    return httpError(502, `Không lấy được số liệu sàn (HTTP ${status || "?"})`);
}

async function requestJson(url, headers, fetchImpl, method = "GET") {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
        const res = await fetchImpl(url, { method, headers, signal: controller.signal });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || (body && body.code && body.msg)) {
            const error = binanceError(res.status, body);
            const retry = res.headers?.get?.("retry-after");
            if (retry) error.retryAfterMs = /^\d+$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now());
            throw error;
        }
        return body;
    } catch (error) {
        if (error.status) throw error;
        if (error.name === "AbortError") throw httpError(504, "Sàn không phản hồi");
        console.error("[binanceFutures]", error.message);
        throw httpError(502, "Không kết nối được sàn");
    } finally {
        clearTimeout(timer);
    }
}

function createBinanceFutures({ apiKey, apiSecret, fetchImpl = fetch, publicFetchImpl } = {}) {
    if (!apiKey || !apiSecret) throw httpError(400, "User chưa có API key");
    // Public GET: peer proxy; signed: luôn direct (IP whitelist API key).
    const publicFetch = publicFetchImpl || binancePublicFetch;

    async function signedGet(path, params = {}) {
        const query = signQuery(apiSecret, params);
        return requestJson(`${HOST}${path}?${query}`, { "X-MBX-APIKEY": apiKey }, fetchImpl);
    }

    async function publicGet(path) {
        return requestJson(`${HOST}${path}`, {}, publicFetch);
    }

    async function signed(method, path, params = {}) {
        const query = signQuery(apiSecret, params);
        return requestJson(`${HOST}${path}?${query}`, { "X-MBX-APIKEY": apiKey }, fetchImpl, method);
    }

    return { signedGet, publicGet, signed };
}

async function loadPriceMap(client) {
    try {
        const rows = await client.publicGet("/fapi/v1/ticker/price");
        const map = {};
        for (const row of Array.isArray(rows) ? rows : []) {
            map[String(row.symbol || "").toUpperCase()] = toNum(row.price);
        }
        return map;
    } catch (error) {
        console.error("[loadPriceMap]", error.message);
        return {};
    }
}

function quoteUsdt(asset, amount, prices) {
    const name = String(asset || "USDT").toUpperCase();
    if (QUOTE.has(name)) return amount;
    const px = prices[`${name}USDT`] || prices[name] || 0;
    return px > 0 ? amount * px : 0;
}

module.exports = {
    QUOTE,
    toNum,
    signQuery,
    createBinanceFutures,
    loadPriceMap,
    quoteUsdt,
};
