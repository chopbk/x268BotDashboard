/**
 * Quản lý peer proxy fleet + apply BINANCE_PEER_* vào bot_profile.
 */
const PeerProxyConfig = require("../models/peer-proxy-config");
const ProcessHeartbeat = require("../models/process-heartbeat");
const BotProfile = require("../models/bot-profile");
const processAdmin = require("./process-admin");
const { httpError } = require("./http");
const { setPeerList, urlsFromConfigDoc } = require("./binance-peer-proxy");

const CONFIG_KEY = "default";
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;

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

function matchProfileEnv(hb) {
    return String(hb.botEnv || hb.nodeEnv || hb.processName || "")
        .trim()
        .toUpperCase();
}

async function getStatus() {
    const doc = await loadConfigDoc({ withPass: true });
    const pub = publicConfig(doc);
    const heartbeats = await ProcessHeartbeat.find({}).sort({ at: -1 }).limit(300).lean();
    const byProcess = new Map();
    for (const hb of heartbeats) {
        const name = String(hb.processName || "").trim();
        if (!name || byProcess.has(name)) continue;
        byProcess.set(name, hb);
    }

    const processes = [];
    for (const [processName, hb] of byProcess) {
        const profileEnv = matchProfileEnv(hb);
        const profile = profileEnv
            ? await BotProfile.findOne({ env: profileEnv }).lean()
            : null;
        const vars = profile?.variables || {};
        const proxies = vars.BINANCE_PEER_PROXIES || "";
        const selfIp = vars.BINANCE_PEER_PROXY_SELF_IP || "";
        const hostId = String(hb.hostId || "").trim();
        const mappedSelf = pub.hostSelfIp[hostId] || "";
        processes.push({
            processName,
            profileEnv: profile?.env || profileEnv,
            hasProfile: Boolean(profile),
            revision: profile?.revision ?? null,
            hostId,
            mappedSelfIp: mappedSelf,
            enabled: Boolean(proxies),
            selfIp,
            proxyCount: proxies ? String(proxies).split(",").filter(Boolean).length : 0,
            proxiesPreview: redactProxyList(proxies),
        });
    }

    return { config: pub, processes };
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
    const hostSelfIpIn =
        body?.hostSelfIp && typeof body.hostSelfIp === "object" ? body.hostSelfIp : {};
    const hostSelfIp = {};
    for (const [hid, rawIp] of Object.entries(hostSelfIpIn)) {
        const h = String(hid || "").trim();
        const ip = normalizeIp(rawIp);
        if (!h || !ip) continue;
        hostSelfIp[h] = ip;
    }

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
                hostSelfIp,
                updatedBy: String(actor?.email || actor?.id || actor || "").slice(0, 128),
            },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).select("+authPass");

    // Web server cũng dùng pool này cho public GET (trừ khi đã set BINANCE_PEER_PROXIES env).
    if (!String(process.env.BINANCE_PEER_PROXIES || "").trim()) {
        const selfIp = String(process.env.BINANCE_PEER_PROXY_SELF_IP || "").trim();
        const plain = doc.toObject();
        setPeerList(urlsFromConfigDoc(plain, selfIp), { selfIp, label: "peer_proxy_config" });
    }

    return publicConfig(doc.toObject());
}

function resolveSelfIp(processRow, config, overrideSelfIp) {
    if (overrideSelfIp) {
        const ip = normalizeIp(overrideSelfIp);
        if (!ip) throw httpError(400, `selfIp không hợp lệ: ${overrideSelfIp}`);
        return ip;
    }
    const hostId = String(processRow.hostId || "").trim();
    if (hostId && config.hostSelfIp?.[hostId]) {
        return config.hostSelfIp[hostId];
    }
    if (processRow.selfIp && normalizeIp(processRow.selfIp)) {
        return normalizeIp(processRow.selfIp);
    }
    if (processRow.mappedSelfIp && normalizeIp(processRow.mappedSelfIp)) {
        return normalizeIp(processRow.mappedSelfIp);
    }
    throw httpError(
        400,
        `Chưa map selfIp cho ${processRow.processName} (hostId=${hostId || "—"}). Điền hostSelfIp trong cấu hình.`
    );
}

function buildPeerUrls(config, selfIp, authPass) {
    const user = config.authUser || "botpeer";
    if (!authPass) throw httpError(400, "Chưa đặt mật khẩu proxy — lưu authPass trước");
    const urls = [];
    for (const peer of config.peers || []) {
        if (peer.enabled === false) continue;
        if (peer.ip === selfIp) continue;
        urls.push(buildProxyUrl(user, authPass, peer.ip, peer.port || 13128));
    }
    if (!urls.length) {
        throw httpError(400, "Không còn peer nào (pool trống hoặc chỉ còn self)");
    }
    return urls.join(",");
}

async function applyEnable(body, actor) {
    const doc = await loadConfigDoc({ withPass: true });
    const config = publicConfig(doc);
    const status = await getStatus();
    const wanted = new Set(
        (body?.processNames || []).map((s) => String(s).trim()).filter(Boolean)
    );
    const targets = status.processes.filter((p) => !wanted.size || wanted.has(p.processName));
    if (!targets.length) throw httpError(400, "Không có process để bật");

    const reason = String(body?.reason || `peer-proxy enable`).trim();
    const results = [];
    for (const row of targets) {
        try {
            if (!row.hasProfile) {
                throw httpError(400, `Chưa có bot_profile ${row.profileEnv}`);
            }
            const selfIp = resolveSelfIp(row, config, body?.selfIpByProcess?.[row.processName]);
            const urls = buildPeerUrls(config, selfIp, doc.authPass);
            const saved = await processAdmin.patchProfile(
                row.profileEnv,
                {
                    patch: {
                        BINANCE_PEER_PROXIES: urls,
                        BINANCE_PEER_PROXY_SELF_IP: selfIp,
                    },
                    expectedRevision: Number(row.revision || 1),
                    reason,
                },
                actor
            );
            let command = null;
            if (body?.restart) {
                command = await processAdmin.createCommand(
                    row.profileEnv,
                    {
                        kind: "restart",
                        reason: `${reason} + restart`,
                        requestedRevision: saved.revision,
                        processName: row.processName,
                        hostId: row.hostId,
                    },
                    actor
                );
            }
            results.push({
                processName: row.processName,
                profileEnv: row.profileEnv,
                ok: true,
                selfIp,
                proxyCount: urls.split(",").length,
                revision: saved.revision,
                commandId: command?.id || null,
            });
        } catch (err) {
            results.push({
                processName: row.processName,
                profileEnv: row.profileEnv,
                ok: false,
                error: err.message || String(err),
            });
        }
    }
    return { results };
}

async function applyDisable(body, actor) {
    const status = await getStatus();
    const wanted = new Set(
        (body?.processNames || []).map((s) => String(s).trim()).filter(Boolean)
    );
    const targets = status.processes.filter((p) => !wanted.size || wanted.has(p.processName));
    if (!targets.length) throw httpError(400, "Không có process để tắt");

    const reason = String(body?.reason || `peer-proxy disable`).trim();
    const results = [];
    for (const row of targets) {
        try {
            if (!row.hasProfile) {
                throw httpError(400, `Chưa có bot_profile ${row.profileEnv}`);
            }
            const saved = await processAdmin.patchProfile(
                row.profileEnv,
                {
                    unset: ["BINANCE_PEER_PROXIES", "BINANCE_PEER_PROXY_SELF_IP"],
                    expectedRevision: Number(row.revision || 1),
                    reason,
                },
                actor
            );
            let command = null;
            if (body?.restart) {
                command = await processAdmin.createCommand(
                    row.profileEnv,
                    {
                        kind: "restart",
                        reason: `${reason} + restart`,
                        requestedRevision: saved.revision,
                        processName: row.processName,
                        hostId: row.hostId,
                    },
                    actor
                );
            }
            results.push({
                processName: row.processName,
                profileEnv: row.profileEnv,
                ok: true,
                revision: saved.revision,
                commandId: command?.id || null,
            });
        } catch (err) {
            results.push({
                processName: row.processName,
                profileEnv: row.profileEnv,
                ok: false,
                error: err.message || String(err),
            });
        }
    }
    return { results };
}

module.exports = {
    getStatus,
    saveConfig,
    applyEnable,
    applyDisable,
    redactProxyList,
    buildProxyUrl,
    normalizeIp,
};
