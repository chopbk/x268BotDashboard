/**
 * HTTP public Binance cho Smart Money — bucket theo host, cooldown Redis dùng chung.
 * bapi cùng endpoint 0xBennie; header browser-like; đi peer proxy khi có (giống fapi public).
 * Không rotate proxy giữa chừng để vượt WAF; tôn trọng Retry-After.
 */
const { getRedisClient } = require("../rate-limit-store");
const { binancePublicFetch, peerProxyCount } = require("../binance-peer-proxy");
const { config } = require("./config");

const HOSTS = Object.freeze({
    fapi: "https://fapi.binance.com",
    futuresData: "https://fapi.binance.com",
    bapi: "https://www.binance.com",
});

/** Header giống client web (0xBennie) — UA bot dễ dính 418 hơn. */
const BAPI_HEADERS = Object.freeze({
    accept: "application/json",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    clienttype: "web",
    lang: "zh-CN",
});

/** @type {Map<string, { lastAt: number, gapMs: number, blockedUntil: number, lastLogAt: number }>} */
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
        b = {
            lastAt: 0,
            gapMs: host === "bapi" ? config.smartMoneyGapMs : config.fapiGapMs,
            blockedUntil: 0,
            lastLogAt: 0,
        };
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

async function clearSharedCooldown(host) {
    const local = getLocal(host);
    local.blockedUntil = 0;
    local.gapMs = host === "bapi" ? config.smartMoneyGapMs : config.fapiGapMs;
    const client = getRedisClient();
    if (!client?.isReady) return;
    try {
        await client.del(bucketKey(host));
    } catch (error) {
        console.warn("[smartMoneyHttp] cooldown clear", error.message || error);
    }
}

async function getCooldownRemainingMs(host) {
    const local = getLocal(host);
    const sharedUntil = await readSharedCooldown(host);
    const until = Math.max(local.blockedUntil, sharedUntil);
    return Math.max(0, until - Date.now());
}

function logCooldownOnce(host, waitMs) {
    const local = getLocal(host);
    const now = Date.now();
    if (now - local.lastLogAt < 60_000) return;
    local.lastLogAt = now;
    console.warn(`[smartMoneyHttp] ${host} cooldown còn ~${Math.round(waitMs / 1000)}s — bỏ qua bapi, fapi vẫn chạy`);
}

async function waitForBudget(host) {
    const local = getLocal(host);
    const sharedUntil = await readSharedCooldown(host);
    const blockedUntil = Math.max(local.blockedUntil, sharedUntil);
    const now = Date.now();
    if (blockedUntil > now) {
        const wait = blockedUntil - now;
        // Cooldown dài: không sleep, caller xử lý (skip nguồn đó).
        if (wait > 15_000) {
            logCooldownOnce(host, wait);
            const err = new Error(`cooldown_${host}`);
            err.code = "COOLDOWN";
            err.host = host;
            err.retryAfterMs = wait;
            throw err;
        }
        await sleep(wait);
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
    // Trần 2h cho soft — vẫn gần Retry-After thực tế, tránh khóa vô hạn do header lệch.
    if ((status === 418 || status === 429) && ttl > 2 * 60 * 60_000) {
        ttl = 2 * 60 * 60_000;
    }
    local.gapMs = Math.min(60_000, Math.max(local.gapMs * 2, host === "bapi" ? 15_000 : 1_200));
    await writeSharedCooldown(host, Date.now() + ttl);
    console.warn(
        `[smartMoneyHttp] ${host} status=${status} cooldown=${Math.round(ttl / 1000)}s` +
            (peerProxyCount() ? ` peers=${peerProxyCount()}` : " peers=0(direct)")
    );
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
        ...(host === "bapi" ? BAPI_HEADERS : {}),
        ...(opts.headers || {}),
    };

    const local = getLocal(host);
    local.lastAt = Date.now();

    // bapi: bắt buộc peer khi đã cấu hình — không fallback IP VPS (đó là gốc 418 dài).
    // fapi: peer rồi mới direct như cũ.
    const preferPeer = opts.usePeer !== false;
    const requirePeer = host === "bapi" && preferPeer && peerProxyCount() > 0;

    let res;
    try {
        if (preferPeer) {
            res = await binancePublicFetch(url, {
                headers,
                signal: AbortSignal.timeout(timeoutMs),
                requirePeer,
                peerAttempts: requirePeer ? Math.min(4, Math.max(1, peerProxyCount())) : 1,
            });
        } else {
            res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
        }
    } catch (error) {
        const err = new Error(error.message || "network_error");
        err.code = error.code === "PEER_REQUIRED" ? "PEER_REQUIRED" : "NETWORK";
        err.host = host;
        err.cause = error;
        throw err;
    }

    if (res.status === 418 || res.status === 429 || res.status === 403) {
        await markBlocked(host, res.status, parseRetryAfter(res));
        const err = new Error(`http_${res.status}`);
        err.status = res.status;
        err.code = "RATE_LIMIT";
        err.host = host;
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
        err.host = host;
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
    BAPI_HEADERS,
    smartMoneyFetch,
    waitForBudget,
    markBlocked,
    clearSharedCooldown,
    getCooldownRemainingMs,
    resetHttpForTests,
    readSharedCooldown,
};
