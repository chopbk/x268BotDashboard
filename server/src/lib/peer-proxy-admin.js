/**
 * Peer proxy — theo dõi sức khỏe + probe fapi qua tinyproxy.
 * Không phải UI gắn BINANCE_PEER_* vào bot_profile (env process vẫn sửa ở panel Env).
 */
const PeerProxyConfig = require("../models/peer-proxy-config");
const RuntimeLog = require("../models/runtime-log");
const { httpError } = require("./http");
const {
    setPeerList,
    urlsFromConfigDoc,
    peerProxyCount,
    peerProxySource,
    fetchViaHttpProxy,
    parseEnvList,
} = require("./binance-peer-proxy");

const CONFIG_KEY = "default";
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const PROBE_HISTORY_MAX = 40;
const PING_PATH = "https://fapi.binance.com/fapi/v1/ping";

function normalizeIp(raw) {
    const ip = String(raw || "").trim();
    if (!ip || !IPV4.test(ip)) return null;
    const parts = ip.split(".").map(Number);
    if (parts.some((n) => n < 0 || n > 255)) return null;
    return ip;
}

function normalizePort(raw) {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1 || n > 65535) return 13128;
    return n;
}

function buildProxyUrl(user, pass, ip, port) {
    const u = encodeURIComponent(String(user || "").trim());
    const p = encodeURIComponent(String(pass || ""));
    return `http://${u}:${p}@${ip}:${port}`;
}

function redactProxyList(raw) {
    if (!raw) return "";
    return String(raw).replace(/:([^:@/]+)@/g, ":***@");
}

function peersFromEnvCsv(raw) {
    return parseEnvList(raw, "").map((url) => {
        try {
            const u = new URL(url);
            return {
                ip: u.hostname,
                port: Number(u.port) || 13128,
                enabled: true,
                label: "",
                from: "env",
            };
        } catch {
            return null;
        }
    }).filter(Boolean);
}

async function loadConfigDoc({ withPass = false } = {}) {
    let q = PeerProxyConfig.findOne({ key: CONFIG_KEY });
    if (withPass) q = q.select("+authPass");
    let doc = await q.lean();
    if (!doc) {
        doc = {
            key: CONFIG_KEY,
            peers: [],
            authUser: "botpeer",
            authPass: "",
            hostSelfIp: {},
            lastProbe: null,
            probeHistory: [],
            updatedBy: "",
            updatedAt: null,
        };
    }
    return doc;
}

function publicConfig(doc) {
    const hostSelfIp =
        doc.hostSelfIp instanceof Map
            ? Object.fromEntries(doc.hostSelfIp)
            : { ...(doc.hostSelfIp || {}) };
    return {
        key: doc.key || CONFIG_KEY,
        peers: (doc.peers || []).map((p) => ({
            ip: p.ip,
            port: p.port || 13128,
            enabled: p.enabled !== false,
            label: p.label || "",
        })),
        authUser: doc.authUser || "botpeer",
        passwordSet: Boolean(doc.authPass),
        hostSelfIp,
        updatedBy: doc.updatedBy || "",
        updatedAt: doc.updatedAt || null,
    };
}

/** Danh sách peer để hiển thị / probe: env ưu tiên, không thì Mongo. */
function resolvePeers(doc) {
    const envRaw = String(process.env.BINANCE_PEER_PROXIES || "").trim();
    if (envRaw) {
        return { peers: peersFromEnvCsv(envRaw), source: "env" };
    }
    return {
        peers: (doc.peers || [])
            .filter((p) => p.enabled !== false && p.ip)
            .map((p) => ({
                ip: p.ip,
                port: p.port || 13128,
                enabled: true,
                label: p.label || "",
                from: "mongo",
            })),
        source: doc.peers?.length ? "mongo" : "none",
    };
}

function summarizeProbe(lastProbe) {
    if (!lastProbe?.results?.length) return null;
    const ok = lastProbe.results.filter((r) => r.ok).length;
    const fail = lastProbe.results.length - ok;
    return {
        at: lastProbe.at || null,
        ok,
        fail,
        total: lastProbe.results.length,
        probedBy: lastProbe.probedBy || "",
    };
}

async function getRelatedLogs(peers, limit = 30) {
    const ips = peers.map((p) => p.ip).filter(Boolean);
    const or = [
        { message: /peer.?proxy|binancePeerProxy|tinyproxy/i },
        { source: /peer.?proxy/i },
    ];
    for (const ip of ips.slice(0, 12)) {
        or.push({ message: new RegExp(ip.replace(/\./g, "\\.")) });
    }
    const rows = await RuntimeLog.find({ $or: or })
        .sort({ at: -1 })
        .limit(limit)
        .select("at level category processName host env usernames source message")
        .lean();
    return rows.map((r) => ({
        at: r.at,
        level: r.level || "",
        category: r.category || "",
        processName: r.processName || "",
        host: r.host || "",
        env: r.env || "",
        usernames: r.usernames || [],
        source: r.source || "",
        message: String(r.message || "").slice(0, 400),
    }));
}

async function getStatus() {
    const doc = await loadConfigDoc({ withPass: true });
    const { peers, source: peerSource } = resolvePeers(doc);
    const lastProbe = doc.lastProbe || null;
    const byIp = new Map((lastProbe?.results || []).map((r) => [r.ip, r]));

    const peerRows = peers.map((p) => {
        const hit = byIp.get(p.ip);
        return {
            ...p,
            lastOk: hit ? Boolean(hit.ok) : null,
            lastMs: hit?.ms ?? null,
            lastError: hit?.error || "",
            lastCheckedAt: hit?.at || lastProbe?.at || null,
        };
    });

    const history = Array.isArray(doc.probeHistory) ? doc.probeHistory.slice(0, 20) : [];
    const relatedLogs = await getRelatedLogs(peers);

    return {
        runtime: {
            activeCount: peerProxyCount(),
            source: peerProxySource(),
            selfIp: String(process.env.BINANCE_PEER_PROXY_SELF_IP || "").trim(),
        },
        peerSource,
        peers: peerRows,
        passwordSet: Boolean(doc.authPass) || Boolean(String(process.env.BINANCE_PEER_PROXIES || "").trim()),
        authUser: doc.authUser || "botpeer",
        lastProbe: summarizeProbe(lastProbe),
        lastProbeResults: lastProbe?.results || [],
        probeHistory: history,
        relatedLogs,
        /** Cấu hình Mongo (sửa pool cho web hydrate) — không gắn process bot */
        config: publicConfig(doc),
    };
}

async function resolveProbeTargets(doc) {
    const envRaw = String(process.env.BINANCE_PEER_PROXIES || "").trim();
    if (envRaw) {
        return parseEnvList(envRaw, "").map((url) => {
            const u = new URL(url);
            return { ip: u.hostname, port: Number(u.port) || 13128, url };
        });
    }
    if (!doc.authPass) throw httpError(400, "Chưa có mật khẩu proxy — lưu pool trên panel hoặc set BINANCE_PEER_PROXIES");
    const urls = urlsFromConfigDoc(doc, "");
    if (!urls.length) throw httpError(400, "Chưa có peer trong pool");
    return urls.map((url) => {
        const u = new URL(url);
        return { ip: u.hostname, port: Number(u.port) || 13128, url };
    });
}

/** Probe: CONNECT qua peer → GET fapi/v1/ping */
async function probePeer(proxyUrl) {
    const started = Date.now();
    const ip = (() => {
        try {
            return new URL(proxyUrl).hostname;
        } catch {
            return "";
        }
    })();
    try {
        const res = await fetchViaHttpProxy(PING_PATH, proxyUrl, { timeoutMs: 12000 });
        const ms = Date.now() - started;
        if (!res.ok) {
            return { ip, ok: false, ms, error: `HTTP ${res.status}`, at: new Date() };
        }
        return { ip, ok: true, ms, error: "", at: new Date() };
    } catch (error) {
        return {
            ip,
            ok: false,
            ms: Date.now() - started,
            error: String(error.message || error).slice(0, 160),
            at: new Date(),
        };
    }
}

async function runProbe(actor) {
    const doc = await loadConfigDoc({ withPass: true });
    const targets = await resolveProbeTargets(doc);
    const results = [];
    for (const t of targets) {
        results.push(await probePeer(t.url));
    }
    const snapshot = {
        at: new Date(),
        probedBy: String(actor?.email || actor?.id || "").slice(0, 128),
        results: results.map((r) => ({
            ip: r.ip,
            ok: r.ok,
            ms: r.ms,
            error: r.error || "",
            at: r.at,
        })),
    };
    const historyEntry = {
        at: snapshot.at,
        ok: results.filter((r) => r.ok).length,
        fail: results.filter((r) => !r.ok).length,
        probedBy: snapshot.probedBy,
        summary: results.map((r) => `${r.ip}:${r.ok ? "ok" : "fail"}(${r.ms}ms)`).join(", "),
    };

    await PeerProxyConfig.findOneAndUpdate(
        { key: CONFIG_KEY },
        {
            $set: { lastProbe: snapshot },
            $push: {
                probeHistory: {
                    $each: [historyEntry],
                    $position: 0,
                    $slice: PROBE_HISTORY_MAX,
                },
            },
        },
        { upsert: true }
    );

    return {
        at: snapshot.at,
        ok: historyEntry.ok,
        fail: historyEntry.fail,
        results: snapshot.results,
    };
}

async function saveConfig(body, actor) {
    const peersIn = Array.isArray(body?.peers) ? body.peers : null;
    if (!peersIn) throw httpError(400, "peers[] bắt buộc");

    const peers = [];
    const seen = new Set();
    for (const row of peersIn) {
        const ip = normalizeIp(row?.ip);
        if (!ip) throw httpError(400, `IP không hợp lệ: ${row?.ip}`);
        if (seen.has(ip)) continue;
        seen.add(ip);
        peers.push({
            ip,
            port: normalizePort(row?.port),
            enabled: row?.enabled !== false,
            label: String(row?.label || "").trim().slice(0, 64),
        });
    }

    const authUser = String(body?.authUser || "botpeer").trim() || "botpeer";
    const existing = await PeerProxyConfig.findOne({ key: CONFIG_KEY }).select("+authPass");
    let authPass = existing?.authPass || "";
    if (body?.authPass != null && String(body.authPass).trim() !== "") {
        authPass = String(body.authPass).trim();
    }
    if (body?.clearPass === true) authPass = "";

    const doc = await PeerProxyConfig.findOneAndUpdate(
        { key: CONFIG_KEY },
        {
            $set: {
                peers,
                authUser,
                authPass,
                updatedBy: String(actor?.email || actor?.id || actor || "").slice(0, 128),
            },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).select("+authPass");

    if (!String(process.env.BINANCE_PEER_PROXIES || "").trim()) {
        const selfIp = String(process.env.BINANCE_PEER_PROXY_SELF_IP || "").trim();
        setPeerList(urlsFromConfigDoc(doc.toObject(), selfIp), {
            selfIp,
            label: "peer_proxy_config",
        });
    }

    return publicConfig(doc.toObject());
}

module.exports = {
    getStatus,
    runProbe,
    saveConfig,
    redactProxyList,
    buildProxyUrl,
    normalizeIp,
    // giữ export cũ nếu test còn gọi — stub
    applyEnable: async () => {
        throw httpError(410, "Bật proxy process đã bỏ khỏi panel — sửa BINANCE_PEER_* trong Env process");
    },
    applyDisable: async () => {
        throw httpError(410, "Tắt proxy process đã bỏ khỏi panel — sửa BINANCE_PEER_* trong Env process");
    },
};
