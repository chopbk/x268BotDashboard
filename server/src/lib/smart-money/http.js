/**
 * HTTP public Binance cho Smart Money — bucket theo host, cooldown Redis dùng chung.
 * Không đổi proxy để vượt 418/429; tôn trọng Retry-After.
 */
const { getRedisClient } = require("../rate-limit-store");
const { binancePublicFetch } = require("../binance-peer-proxy");
const { config } = require("./config");

const HOSTS = Object.freeze({
    fapi: "https://fapi.binance.com",
    futuresData: "https://fapi.binance.com",
    bapi: "https://www.binance.com",
});

/** @type {Map<string, { lastAt: number, gapMs: number, blockedUntil: number }>} */
const localBuckets = new Map();

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function bucketKey(host) {
    return `wb:sm:cooldown:${host}`;
}

function getLocal(host) {
    let b = localBuckets.get(host);
    if (!b) {
        b = { lastAt: 0, gapMs: host === "bapi" ? config.smartMoneyGapMs : config.fapiGapMs, blockedUntil: 0 };
        localBuckets.set(host, b);
    }
    return b;
}

async function readSharedCooldown(host) {
    const client = getRedisClient();
    if (!client?.isReady) return 0;
    try {
        const raw = await client.get(bucketKey(host));
        const until = Number(raw);
        return Number.isFinite(until) ? until : 0;
    } catch {
        return 0;
    }
}

async function writeSharedCooldown(host, untilMs) {
    const client = getRedisClient();
    const ttl = Math.max(1000, untilMs - Date.now());
    const local = getLocal(host);
    local.blockedUntil = Math.max(local.blockedUntil, untilMs);
    if (!client?.isReady) return;
    try {
        await client.set(bucketKey(host), String(untilMs), { PX: ttl });
    } catch (error) {
        console.warn("[smartMoneyHttp] cooldown write", error.message || error);
    }
}

async function waitForBudget(host) {
    const local = getLocal(host);
    const sharedUntil = await readSharedCooldown(host);
    const blockedUntil = Math.max(local.blockedUntil, sharedUntil);
    const now = Date.now();
    if (blockedUntil > now) {
        const wait = blockedUntil - now;
        if (wait > 5 * 60_000) {
            console.warn(`[smartMoneyHttp] ${host} cooldown ${Math.round(wait / 1000)}s — skip wait, caller should abort`);
            const err = new Error(`cooldown_${host}`);
            err.code = "COOLDOWN";
            err.retryAfterMs = wait;
            throw err;
        }
        await sleep(Math.min(wait, 60_000));
    }
    const gap = local.gapMs + (host === "bapi" ? Math.floor(Math.random() * (config.smartMoneyJitterMs + 1)) : 0);
    const waitGap = Math.max(0, gap - (Date.now() - local.lastAt));
    if (waitGap > 0) await sleep(waitGap);
}

function parseRetryAfter(res) {
    const ra = res.headers?.get?.("retry-after") || res.headers?.["retry-after"];
    const sec = parseInt(String(ra || ""), 10);
    return Number.isFinite(sec) && sec > 0 ? sec * 1000 : 0;
}

async function markBlocked(host, status, retryAfterMs) {
    const local = getLocal(host);
    let ttl = retryAfterMs;
    if (!(ttl > 0)) {
        if (status === 403) ttl = 90 * 60_000;
        else if (status === 418 || status === 429) ttl = Math.max(5 * 60_000, local.gapMs * 4);
        else ttl = 60_000;
    }
    local.gapMs = Math.min(60_000, Math.max(local.gapMs * 2, host === "bapi" ? 15_000 : 1_200));
    await writeSharedCooldown(host, Date.now() + ttl);
    console.warn(`[smartMoneyHttp] ${host} status=${status} cooldown=${Math.round(ttl / 1000)}s`);
}

/**
 * @param {"fapi"|"futuresData"|"bapi"} host
 * @param {string} pathWithQuery
 * @param {{ headers?: Record<string,string>, timeoutMs?: number, usePeer?: boolean }} [opts]
 */
async function smartMoneyFetch(host, pathWithQuery, opts = {}) {
    await waitForBudget(host);
    const base = HOSTS[host] || HOSTS.fapi;
    const url = pathWithQuery.startsWith("http") ? pathWithQuery : `${base}${pathWithQuery}`;
    const timeoutMs = opts.timeoutMs || 12_000;
    const headers = {
        accept: "application/json",
        ...(opts.headers || {}),
    };
    if (host === "bapi") {
        headers["user-agent"] =
            "Mozilla/5.0 (compatible; WebBotSmartMoney/1.0; +https://localhost)";
        headers.clienttype = "web";
        headers.lang = "en";
    }

    const local = getLocal(host);
    local.lastAt = Date.now();

    let res;
    try {
        if (host === "bapi" || opts.usePeer === false) {
            res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
        } else {
            res = await binancePublicFetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
        }
    } catch (error) {
        const err = new Error(error.message || "network_error");
        err.code = "NETWORK";
        err.cause = error;
        throw err;
    }

    if (res.status === 418 || res.status === 429 || res.status === 403) {
        await markBlocked(host, res.status, parseRetryAfter(res));
        const err = new Error(`http_${res.status}`);
        err.status = res.status;
        err.code = "RATE_LIMIT";
        throw err;
    }

    const text = await res.text();
    let body = null;
    try {
        body = text ? JSON.parse(text) : null;
    } catch {
        body = null;
    }

    if (!res.ok) {
        const err = new Error(body?.msg || body?.message || `http_${res.status}`);
        err.status = res.status;
        err.code = "HTTP";
        err.body = body;
        throw err;
    }

    local.gapMs = Math.max(
        host === "bapi" ? config.smartMoneyGapMs : config.fapiGapMs,
        Math.floor(local.gapMs * 0.9)
    );
    return { status: res.status, body, headers: res.headers };
}

function resetHttpForTests() {
    localBuckets.clear();
}

module.exports = {
    HOSTS,
    smartMoneyFetch,
    waitForBudget,
    markBlocked,
    resetHttpForTests,
    readSharedCooldown,
};
