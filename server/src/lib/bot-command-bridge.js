const crypto = require("crypto");
const AccountConfig = require("../models/account-config");
const BotCommand = require("../models/bot-command");
const { PERMISSIONS, hasPermission } = require("../auth/access-control");
const { httpError } = require("./http");
const { requireBot, normalizeName } = require("./bot-directory");
const {
    startBotMqtt,
    onResponse,
    publishConfigSync,
    publishNewCommand,
    isConnected,
} = require("./bot-mqtt");

const DEFAULT_TTL_MS = 30_000;
const TERMINAL = new Set(["succeeded", "failed", "expired"]);

/** action → { kind, permission, mapCommand? } */
const ALLOWLIST = Object.freeze({
    APPLY_CONFIG: {
        kind: "config_sync",
        permission: PERMISSIONS.CONFIG_EDIT,
    },
    GET_RUNTIME_CONFIG: {
        kind: "command",
        permission: PERMISSIONS.CONFIG_VIEW,
        mapCommand: (env) => `${env}/C`,
    },
    GET_POSITIONS: {
        kind: "command",
        permission: PERMISSIONS.POSITIONS_VIEW,
        mapCommand: (env) => `${env}/P`,
    },
    GET_BALANCE: {
        kind: "command",
        permission: PERMISSIONS.STATISTICS_VIEW,
        mapCommand: (env) => `${env}/B`,
    },
    GET_MONITORS: {
        kind: "command",
        permission: PERMISSIONS.POSITIONS_VIEW,
        mapCommand: (env) => `${env}/M`,
    },
    GET_ORDERS: {
        kind: "command",
        permission: PERMISSIONS.POSITIONS_VIEW,
        mapCommand: (env) => `${env}/OD`,
    },
});

let responseBound = false;
let expireTimer = null;

function publicCommand(doc) {
    if (!doc) return null;
    return {
        requestId: doc.requestId,
        username: doc.username,
        targetEnv: doc.targetEnv,
        action: doc.action,
        status: doc.status,
        terminal: !!doc.terminal,
        messages: (doc.messages || []).map((m) => ({
            status: m.status,
            message: m.message,
            error: m.error || null,
            timestamp: m.timestamp || null,
            at: m.at,
        })),
        error: doc.error || null,
        publishedAt: doc.publishedAt,
        expiresAt: doc.expiresAt,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        attempt: doc.attempt,
    };
}

async function listReloadEnvs(targetEnv) {
    const env = String(targetEnv || "").toUpperCase();
    if (!env) return [];
    const followers = await AccountConfig.find({ sync_from: env }).select("env").lean();
    const names = [env];
    for (const row of followers) {
        const fol = String(row?.env || "").toUpperCase();
        if (fol && !names.includes(fol)) names.push(fol);
    }
    return names;
}

async function assertActionAccess(actor, username, targetEnv, action) {
    const spec = ALLOWLIST[action];
    if (!spec) throw httpError(400, `Action không được phép: ${action}`);
    if (!hasPermission(actor, spec.permission)) {
        throw httpError(403, "Không có quyền");
    }
    const bot = await requireBot(actor, username, spec.permission);
    const env = String(targetEnv || "").toUpperCase();
    const accounts = (bot.accounts || []).map((a) => String(a).toUpperCase());
    if (!accounts.includes(env)) {
        throw httpError(404, `Không có account ${env}`);
    }
    return { bot, env, spec };
}

function mapOutboxStatus(mqttStatus) {
    if (mqttStatus === "received") return "received";
    if (mqttStatus === "running") return "running";
    if (mqttStatus === "succeeded") return "succeeded";
    if (mqttStatus === "failed") return "failed";
    return null;
}

async function applyResponsePayload(payload) {
    try {
        if (!payload?.requestId || payload.version !== 1) return;
        const requestId = String(payload.requestId);
        const targetEnv = String(payload.targetEnv || "").toUpperCase();
        const doc = await BotCommand.findOne({ requestId });
        if (!doc || doc.terminal) return;
        if (targetEnv && doc.targetEnv !== targetEnv) {
            console.warn(
                `[bot-command-bridge] ignore response env mismatch ${requestId} ${targetEnv}!=${doc.targetEnv}`
            );
            return;
        }
        const next = mapOutboxStatus(payload.status);
        if (!next) return;
        doc.messages.push({
            status: next,
            message: payload.message == null ? "" : String(payload.message),
            error: payload.error || null,
            timestamp: payload.timestamp || Date.now(),
            at: new Date(),
        });
        if (payload.error) doc.error = payload.error;
        if (payload.terminal === true || TERMINAL.has(next)) {
            doc.status = next === "running" || next === "received" ? doc.status : next;
            if (next === "succeeded" || next === "failed") {
                doc.status = next;
                doc.terminal = true;
            } else if (payload.terminal === true) {
                doc.status = next === "failed" ? "failed" : "succeeded";
                doc.terminal = true;
            } else {
                doc.status = next;
            }
        } else {
            doc.status = next;
        }
        await doc.save();
    } catch (error) {
        console.error("[bot-command-bridge] applyResponsePayload", error.message);
    }
}

async function markExpired() {
    const now = new Date();
    const rows = await BotCommand.find({
        terminal: false,
        expiresAt: { $lte: now },
        status: { $nin: [...TERMINAL] },
    })
        .limit(100)
        .lean();
    for (const row of rows) {
        await BotCommand.updateOne(
            { requestId: row.requestId, terminal: false },
            {
                $set: {
                    status: "expired",
                    terminal: true,
                    error: { code: "EXPIRED", message: "Hết hạn chờ ACK từ bot" },
                },
                $push: {
                    messages: {
                        status: "expired",
                        message: "Hết hạn chờ ACK từ bot",
                        error: { code: "EXPIRED", message: "Hết hạn chờ ACK từ bot" },
                        timestamp: Date.now(),
                        at: now,
                    },
                },
            }
        );
    }
}

function bindResponseListener() {
    if (responseBound) return;
    responseBound = true;
    onResponse((payload) => {
        applyResponsePayload(payload).catch((err) => {
            console.error("[bot-command-bridge] response", err.message);
        });
    });
    if (!expireTimer) {
        expireTimer = setInterval(() => {
            markExpired().catch((err) => console.error("[bot-command-bridge] expire", err.message));
        }, 5_000);
        if (typeof expireTimer.unref === "function") expireTimer.unref();
    }
}

async function createOutbox({
    actor,
    username,
    targetEnv,
    action,
    params = {},
    ttlMs = DEFAULT_TTL_MS,
}) {
    const { bot, env, spec } = await assertActionAccess(actor, username, targetEnv, action);
    const requestId = crypto.randomUUID();
    const mappedCommand = spec.kind === "command" ? spec.mapCommand(env) : "";
    const doc = await BotCommand.create({
        requestId,
        username: bot.username || normalizeName(username),
        targetEnv: env,
        action,
        params: params && typeof params === "object" ? params : {},
        mappedCommand,
        status: "queued",
        terminal: false,
        actorUserId: actor?.id || (actor?._id ? String(actor._id) : ""),
        actorUsername: actor?.username || actor?.email || "",
        expiresAt: new Date(Date.now() + ttlMs),
        attempt: 1,
        messages: [],
    });
    return doc;
}

async function publishOutbox(doc) {
    bindResponseListener();
    try {
        await startBotMqtt();
    } catch (error) {
        doc.status = "failed";
        doc.terminal = true;
        doc.error = { code: "MQTT_CONNECT", message: error.message };
        doc.messages.push({
            status: "failed",
            message: error.message,
            error: doc.error,
            timestamp: Date.now(),
            at: new Date(),
        });
        await doc.save();
        return doc;
    }

    try {
        if (doc.action === "APPLY_CONFIG") {
            const followers =
                Array.isArray(doc.params?.followers) && doc.params.followers.length
                    ? doc.params.followers.map((e) => String(e).toUpperCase())
                    : await listReloadEnvs(doc.targetEnv);
            if (!followers.includes(doc.targetEnv)) followers.unshift(doc.targetEnv);
            await publishConfigSync({
                source: doc.targetEnv,
                targetEnv: doc.targetEnv,
                followers,
                requestId: doc.requestId,
                ts: Date.now(),
            });
        } else {
            const spec = ALLOWLIST[doc.action];
            if (!spec || spec.kind !== "command") {
                throw new Error(`Action không publish được: ${doc.action}`);
            }
            await publishNewCommand({
                command: doc.mappedCommand || spec.mapCommand(doc.targetEnv),
                cmdInfo: {
                    requestId: doc.requestId,
                    source: "web",
                    targetEnv: doc.targetEnv,
                    action: doc.action,
                },
            });
        }
        doc.status = "published";
        doc.publishedAt = new Date();
        doc.messages.push({
            status: "published",
            message: "Đã gửi MQTT",
            error: null,
            timestamp: Date.now(),
            at: new Date(),
        });
        await doc.save();
    } catch (error) {
        doc.status = "failed";
        doc.terminal = true;
        doc.error = { code: "MQTT_PUBLISH", message: error.message };
        doc.messages.push({
            status: "failed",
            message: error.message,
            error: doc.error,
            timestamp: Date.now(),
            at: new Date(),
        });
        await doc.save();
    }
    return doc;
}

/**
 * Sau khi Mongo đã lưu config — tạo outbox APPLY_CONFIG và publish.
 * Không throw ra ngoài route lưu; trả public apply state.
 */
async function enqueueApplyConfig(actor, username, targetEnv) {
    try {
        bindResponseListener();
        const followers = await listReloadEnvs(targetEnv);
        const doc = await createOutbox({
            actor,
            username,
            targetEnv,
            action: "APPLY_CONFIG",
            params: { followers },
        });
        await publishOutbox(doc);
        return publicCommand(doc);
    } catch (error) {
        console.error("[enqueueApplyConfig]", error.message);
        return {
            requestId: null,
            status: "failed",
            terminal: true,
            error: { code: "ENQUEUE", message: error.message },
            message: error.message,
        };
    }
}

async function enqueueApplyConfigMany(actor, username, envs) {
    const list = [...new Set((envs || []).map((e) => String(e || "").toUpperCase()).filter(Boolean))];
    const applies = [];
    for (const env of list) {
        applies.push(await enqueueApplyConfig(actor, username, env));
    }
    return applies;
}

async function getCommand(actor, requestId) {
    await markExpired();
    const doc = await BotCommand.findOne({ requestId: String(requestId || "") });
    if (!doc) throw httpError(404, "Không tìm thấy lệnh");
    const actorId = actor?.id || (actor?._id ? String(actor._id) : "");
    const isActor = doc.actorUserId && actorId && actorId === doc.actorUserId;
    const canView =
        isActor ||
        hasPermission(actor, PERMISSIONS.CONFIG_VIEW) ||
        hasPermission(actor, PERMISSIONS.LOGS_VIEW);
    if (!canView) throw httpError(403, "Không có quyền");
    if (!isActor) {
        await requireBot(actor, doc.username, PERMISSIONS.CONFIG_VIEW).catch(() => {
            throw httpError(403, "Không có quyền");
        });
    }
    return publicCommand(doc);
}

async function retryApply(actor, username, targetEnv, requestId) {
    const prev = await BotCommand.findOne({ requestId: String(requestId || "") });
    if (!prev) throw httpError(404, "Không tìm thấy lệnh");
    if (prev.username !== username && String(prev.username).toLowerCase() !== String(username).toLowerCase()) {
        throw httpError(404, "Không tìm thấy lệnh");
    }
    if (prev.targetEnv !== String(targetEnv || "").toUpperCase()) {
        throw httpError(400, "env không khớp");
    }
    if (!["failed", "expired"].includes(prev.status)) {
        throw httpError(409, "Chỉ retry khi failed hoặc expired");
    }
    const followers = await listReloadEnvs(targetEnv);
    const doc = await createOutbox({
        actor,
        username,
        targetEnv,
        action: "APPLY_CONFIG",
        params: { followers },
    });
    doc.attempt = (prev.attempt || 1) + 1;
    await doc.save();
    await publishOutbox(doc);
    return publicCommand(doc);
}

async function dispatchCommand(actor, username, targetEnv, body) {
    const action = String(body?.action || "").trim().toUpperCase();
    if (!ALLOWLIST[action]) throw httpError(400, `Action không được phép: ${action}`);
    if (action === "APPLY_CONFIG") {
        return enqueueApplyConfig(actor, username, targetEnv);
    }
    const doc = await createOutbox({
        actor,
        username,
        targetEnv,
        action,
        params: body?.params && typeof body.params === "object" ? body.params : {},
    });
    await publishOutbox(doc);
    return publicCommand(doc);
}

async function initBotCommandBridge() {
    bindResponseListener();
    try {
        await startBotMqtt();
        console.log("[bot-command-bridge] mqtt", isConnected() ? "connected" : "pending");
    } catch (error) {
        console.warn("[bot-command-bridge] mqtt chưa sẵn sàng:", error.message);
    }
}

module.exports = {
    ALLOWLIST,
    publicCommand,
    listReloadEnvs,
    enqueueApplyConfig,
    enqueueApplyConfigMany,
    getCommand,
    retryApply,
    dispatchCommand,
    initBotCommandBridge,
    applyResponsePayload,
};
