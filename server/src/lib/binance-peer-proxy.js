/**
 * Peer tinyproxy cho Binance public GET — cùng model binance-bot.
 * SIGNED / có API key → không dùng module này (đi direct).
 *
 * Env:
 *   BINANCE_PEER_PROXIES=http://user:pass@ip:port,...
 *   BINANCE_PEER_PROXY_SELF_IP=...
 * Hoặc hydrate từ Mongo peer_proxy_config (sau connect).
 */
const http = require("http");
const https = require("https");
const { URL } = require("url");

let list = [];
let idx = 0;
let source = "none";

function normalizeProxyUrl(raw) {
    const s = String(raw || "").trim();
    if (!s) return null;
    return s.includes("://") ? s : `http://${s}`;
}

function parseEnvList(raw, selfIp) {
    return String(raw || "")
        .split(",")
        .map((s) => normalizeProxyUrl(s))
        .filter(Boolean)
        .filter((p) => {
            if (!selfIp) return true;
            try {
                return new URL(p).hostname !== selfIp;
            } catch {
                return true;
            }
        });
}

function loadFromEnv(env = process.env) {
    const selfIp = String(env.BINANCE_PEER_PROXY_SELF_IP || "").trim();
    list = parseEnvList(env.BINANCE_PEER_PROXIES, selfIp);
    source = list.length ? "env" : "none";
    idx = 0;
    if (list.length) {
        console.log(`[binancePeerProxy] loaded ${list.length} peer(s) from env, self=${selfIp || "-"}`);
    }
    return list.length;
}

function setPeerList(urls, { selfIp = "", label = "manual" } = {}) {
    const self = String(selfIp || process.env.BINANCE_PEER_PROXY_SELF_IP || "").trim();
    list = (urls || [])
        .map((u) => normalizeProxyUrl(u))
        .filter(Boolean)
        .filter((p) => {
            if (!self) return true;
            try {
                return new URL(p).hostname !== self;
            } catch {
                return true;
            }
        });
    source = list.length ? label : "none";
    idx = 0;
    if (list.length) {
        console.log(`[binancePeerProxy] loaded ${list.length} peer(s) from ${label}, self=${self || "-"}`);
    }
    return list.length;
}

/** Build CSV URLs từ doc peer_proxy_config (có authPass). */
function urlsFromConfigDoc(doc, selfIp) {
    if (!doc?.authPass) return [];
    const user = String(doc.authUser || "botpeer").trim() || "botpeer";
    const pass = String(doc.authPass);
    const out = [];
    for (const peer of doc.peers || []) {
        if (peer.enabled === false) continue;
        const ip = String(peer.ip || "").trim();
        if (!ip) continue;
        if (selfIp && ip === selfIp) continue;
        const port = Number(peer.port) || 13128;
        out.push(
            `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${ip}:${port}`
        );
    }
    return out;
}

async function hydrateFromMongo(PeerProxyConfig) {
    if (String(process.env.BINANCE_PEER_PROXIES || "").trim()) {
        return loadFromEnv();
    }
    if (!PeerProxyConfig) return 0;
    try {
        const doc = await PeerProxyConfig.findOne({ key: "default" }).select("+authPass").lean();
        if (!doc) return 0;
        const selfIp = String(process.env.BINANCE_PEER_PROXY_SELF_IP || "").trim();
        const urls = urlsFromConfigDoc(doc, selfIp);
        return setPeerList(urls, { selfIp, label: "peer_proxy_config" });
    } catch (error) {
        console.error("[binancePeerProxy] hydrate", error.message || error);
        return 0;
    }
}

function nextPeerProxyUrl() {
    if (!list.length) return null;
    const url = list[idx % list.length];
    idx += 1;
    return url;
}

function peerProxyCount() {
    return list.length;
}

function peerProxySource() {
    return source;
}

function proxyBasicAuth(proxyUrl) {
    if (!proxyUrl.username && !proxyUrl.password) return null;
    const user = decodeURIComponent(proxyUrl.username || "");
    const pass = decodeURIComponent(proxyUrl.password || "");
    return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

/**
 * GET HTTPS target qua HTTP CONNECT proxy. Trả object giống Response tối thiểu.
 */
function fetchViaHttpProxy(targetUrl, proxyUrl, { headers = {}, timeoutMs = 15000, signal } = {}) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const fail = (err) => {
            if (settled) return;
            settled = true;
            reject(err);
        };
        const ok = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };

        let target;
        let proxy;
        try {
            target = new URL(targetUrl);
            proxy = new URL(proxyUrl);
        } catch (error) {
            return fail(error);
        }
        if (target.protocol !== "https:") {
            return fail(new Error("peer proxy chỉ hỗ trợ https target"));
        }

        const onAbort = () => fail(Object.assign(new Error("Aborted"), { name: "AbortError" }));
        if (signal?.aborted) return onAbort();
        signal?.addEventListener("abort", onAbort, { once: true });

        const connectReq = http.request({
            host: proxy.hostname,
            port: Number(proxy.port) || 13128,
            method: "CONNECT",
            path: `${target.hostname}:443`,
            timeout: timeoutMs,
            headers: {
                Host: `${target.hostname}:443`,
                ...(proxyBasicAuth(proxy) ? { "Proxy-Authorization": proxyBasicAuth(proxy) } : {}),
            },
        });

        connectReq.on("timeout", () => {
            connectReq.destroy();
            fail(Object.assign(new Error("Proxy CONNECT timeout"), { name: "AbortError" }));
        });
        connectReq.on("error", fail);
        connectReq.on("connect", (res, socket) => {
            if (res.statusCode !== 200) {
                socket.destroy();
                return fail(new Error(`Proxy CONNECT ${res.statusCode}`));
            }
            const tlsReq = https.request(
                {
                    host: target.hostname,
                    servername: target.hostname,
                    path: `${target.pathname}${target.search}`,
                    method: "GET",
                    headers: { Host: target.hostname, ...headers },
                    socket,
                    timeout: timeoutMs,
                },
                (tlsRes) => {
                    const chunks = [];
                    tlsRes.on("data", (c) => chunks.push(c));
                    tlsRes.on("end", () => {
                        signal?.removeEventListener("abort", onAbort);
                        const buf = Buffer.concat(chunks);
                        const text = buf.toString("utf8");
                        ok({
                            ok: tlsRes.statusCode >= 200 && tlsRes.statusCode < 300,
                            status: tlsRes.statusCode,
                            headers: {
                                get(name) {
                                    const v = tlsRes.headers[String(name || "").toLowerCase()];
                                    return Array.isArray(v) ? v[0] : v ?? null;
                                },
                            },
                            async json() {
                                try {
                                    return text ? JSON.parse(text) : {};
                                } catch {
                                    return {};
                                }
                            },
                            async text() {
                                return text;
                            },
                        });
                    });
                }
            );
            tlsReq.on("timeout", () => {
                tlsReq.destroy();
                fail(Object.assign(new Error("Proxy TLS timeout"), { name: "AbortError" }));
            });
            tlsReq.on("error", fail);
            tlsReq.end();
        });
        connectReq.end();
    });
}

function isProxyTunnelError(error) {
    const msg = String(error?.message || error || "");
    return /proxy|CONNECT|ECONNREFUSED|ETIMEDOUT|ECONNRESET|socket hang up|403|407|Denied/i.test(msg);
}

/**
 * Public GET: thử peer → fail thì direct. Có API key / non-GET → luôn direct.
 */
async function binancePublicFetch(url, init = {}) {
    const method = String(init.method || "GET").toUpperCase();
    const headers = init.headers || {};
    const hasKey = Boolean(headers["X-MBX-APIKEY"] || headers["x-mbx-apikey"]);
    const peer = method === "GET" && !hasKey ? nextPeerProxyUrl() : null;

    if (peer) {
        try {
            return await fetchViaHttpProxy(url, peer, {
                headers,
                timeoutMs: 15000,
                signal: init.signal,
            });
        } catch (error) {
            if (!isProxyTunnelError(error)) throw error;
            console.warn(`[binancePeerProxy] peer fail → direct: ${error.message || error}`);
        }
    }
    return fetch(url, init);
}

// Load env ngay khi require (trước hydrate Mongo).
loadFromEnv();

module.exports = {
    loadFromEnv,
    setPeerList,
    urlsFromConfigDoc,
    hydrateFromMongo,
    nextPeerProxyUrl,
    peerProxyCount,
    peerProxySource,
    fetchViaHttpProxy,
    binancePublicFetch,
    isProxyTunnelError,
    parseEnvList,
};
