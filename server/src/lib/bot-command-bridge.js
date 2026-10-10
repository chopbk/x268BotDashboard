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
const {
    TERMINAL,
    mapOutboxStatus,
    resolveStatusTransition,
    evaluateRoleAcks,
    roleTerminalFromPayload,
} = require("./bot-command-status");

const DEFAULT_TTL_MS = 30_000;

/** action → { kind, permission, mapCommand?, requiredRoles? } */
const ALLOWLIST = Object.freeze({
    APPLY_CONFIG: {
        kind: "config_sync",
        permission: PERMISSIONS.CONFIG_EDIT,
        requiredRoles: ["TRADER"],
    },
    GET_RUNTIME_CONFIG: {
        kind: "command",
        permission: PERMISSIONS.CONFIG_VIEW,
        mapCommand: (env) => `${env}/C`,
        requiredRoles: ["TRADER"],
    },
    GET_POSITIONS: {
        kind: "command",
        permission: PERMISSIONS.POSITIONS_VIEW,
        mapCommand: (env) => `${env}/P`,
        requiredRoles: ["TRADER"],
    },
    GET_BALANCE: {
        kind: "command",
        permission: PERMISSIONS.STATISTICS_VIEW,
        mapCommand: (env) => `${env}/B`,
        requiredRoles: ["TRADER"],
    },
    GET_MONITORS: {
        kind: "command",
        permission: PERMISSIONS.POSITIONS_VIEW,
        mapCommand: (env) => `${env}/M`,
        requiredRoles: ["TRADER"],
    },
    GET_ORDERS: {
        kind: "command",
        permission: PERMISSIONS.POSITIONS_VIEW,
        mapCommand: (env) => `${env}/OD`,
        requiredRoles: ["TRADER"],
    },
});

let responseBound = false;
let expireTimer = null;

function roleAcksToObject(roleAcks) {
    if (!roleAcks) return {};
    if (roleAcks instanceof Map) return Object.fromEntries(roleAcks.entries());
    if (typeof roleAcks.toObject === "function") return roleAcks.toObject();
    return { ...roleAcks };
}

function publicCommand(doc) {
    if (!doc) return null;
    return {
        requestId: doc.requestId,
        username: doc.username,
        targetEnv: doc.targetEnv,
        action: doc.action,
        status: doc.status,
        terminal: !!doc.terminal,
        requiredRoles: doc.requiredRoles || ["TRADER"],
        roleAcks: roleAcksToObject(doc.roleAcks),
        messages: (doc.messages || []).map((m) => ({
            status: m.status,
            message: m.message,
            error: m.error || null,
            processRole: m.processRole || null,
            instanceId: m.instanceId || null,
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

async function applyResponsePayload(payload) {
    try {
        if (!payload?.requestId || payload.version !== 1) return;
        const requestId = String(payload.requestId);
        const targetEnv = String(payload.targetEnv || "").toUpperCase();
        const doc = await BotCommand.findOne({ requestId });
        if (!doc) return;
        if (doc.terminal) return;
        if (doc.status === "expired") return;
        if (targetEnv && doc.targetEnv !== targetEnv) {
            console.warn(
                `[bot-command-bridge] ignore response env mismatch ${requestId} ${targetEnv}!=${doc.targetEnv}`
            );
            return;
        }

        const processRole = String(payload.processRole || "TRADER").toUpperCase();
        const roleResult = roleTerminalFromPayload(payload, doc.targetEnv);
        if (!roleResult) return;

        const msgEntry = {
            status: roleResult.status,
            message: roleResult.message == null ? "" : String(roleResult.message),
            error: roleResult.error || null,
            processRole,
            instanceId: payload.instanceId ? String(payload.instanceId) : "",
            timestamp: payload.timestamp || Date.now(),
            at: new Date(),
        };

        const prevAck = doc.roleAcks?.get?.(processRole) || doc.roleAcks?.[processRole];
        if (prevAck?.terminal) {
            // Role đã terminal — chỉ ghi message audit, không đổi status tổng.
            await BotCommand.updateOne(
                { requestId, terminal: false },
                { $push: { messages: msgEntry } }
            );
            return;
        }

        const roleAck = {
            status: roleResult.status,
            terminal: roleResult.terminal === true,
            instanceId: msgEntry.instanceId,
            applied: Array.isArray(payload.applied)
                ? payload.applied.map((e) => String(e).toUpperCase())
                : [],
            skipped: Array.isArray(payload.skipped)
                ? payload.skipped.map((e) => String(e).toUpperCase())
                : [],
            failed: Array.isArray(payload.failed) ? payload.failed : [],
            message: msgEntry.message,
            error: roleResult.error || null,
            timestamp: msgEntry.timestamp,
            at: msgEntry.at,
        };

        // Monotonic per-role: không cho running → received.
        if (prevAck?.status) {
            const roleTx = resolveStatusTransition(prevAck.status, roleAck.status);
            if (!roleTx.accepted && !roleAck.terminal) {
                await BotCommand.updateOne(
                    { requestId, terminal: false },
                    { $push: { messages: { ...msgEntry, message: `${msgEntry.message} (ignored regress)` } } }
                );
                return;
            }
            if (roleTx.accepted) roleAck.status = roleTx.status;
        }

        doc.roleAcks = doc.roleAcks || new Map();
        if (typeof doc.roleAcks.set === "function") doc.roleAcks.set(processRole, roleAck);
        else doc.roleAcks[processRole] = roleAck;

        const required = doc.requiredRoles?.length ? doc.requiredRoles : ["TRADER"];
        const aggregate = evaluateRoleAcks(required, roleAcksToObject(doc.roleAcks));
        const roleIsRequired = required.map((r) => String(r).toUpperCase()).includes(processRole);

        let nextStatus = doc.status;
        if (aggregate.terminal && aggregate.status) {
            // Chỉ terminal khi đủ requiredRoles (vd. TRADER) — MONITOR không được chốt giúp.
            nextStatus = aggregate.status;
        } else if (aggregate.status) {
            const tx = resolveStatusTransition(doc.status, aggregate.status);
            if (tx.accepted) nextStatus = tx.status;
        } else if (roleIsRequired) {
            const mapped = mapOutboxStatus(payload.status);
            if (mapped && !TERMINAL.has(mapped)) {
                const tx = resolveStatusTransition(doc.status, mapped);
                if (tx.accepted) nextStatus = tx.status;
            }
        }

        const setFields = {
            status: nextStatus,
            [`roleAcks.${processRole}`]: roleAck,
        };
        if (roleResult.error && roleIsRequired) setFields.error = roleResult.error;

        if (aggregate.terminal) {
            setFields.terminal = true;
            setFields.status = aggregate.status;
        }

        await BotCommand.updateOne(
            { requestId, terminal: false },
            {
                $set: setFields,
                $push: { messages: msgEntry },
            }
        );
    } catch (error) {
        console.error("[bot-command-bridge] applyResponsePayload", error.message);
    }
}

async function markExpired() {
    const now = new Date();
    await BotCommand.updateMany(
        {
            terminal: false,
            expiresAt: { $lte: now },
            status: { $nin: [...TERMINAL] },
        },
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
        requiredRoles: spec.requiredRoles ? [...spec.requiredRoles] : ["TRADER"],
        roleAcks: {},
        actorUserId: actor?.id || (actor?._id ? String(actor._id) : ""),
        actorUsername: actor?.username || actor?.email || "",
        expiresAt: new Date(Date.now() + ttlMs),
        attempt: 1,
        messages: [],
    });
    return doc;
}

/**
 * Đánh published TRƯỚC khi MQTT publish — tránh ACK nhanh bị save() ghi đè về published.
 * Sau publish luôn đọc lại document mới nhất.
 */
async function publishOutbox(doc) {
    bindResponseListener();
    const requestId = doc.requestId;

    try {
        await startBotMqtt();
    } catch (error) {
        await BotCommand.updateOne(
            { requestId, terminal: false },
            {
                $set: {
                    status: "failed",
                    terminal: true,
                    error: { code: "MQTT_CONNECT", message: error.message },
                },
                $push: {
                    messages: {
                        status: "failed",
                        message: error.message,
                        error: { code: "MQTT_CONNECT", message: error.message },
                        timestamp: Date.now(),
                        at: new Date(),
                    },
                },
            }
        );
        return BotCommand.findOne({ requestId });
    }

    const publishedAt = new Date();
    await BotCommand.updateOne(
        { requestId, terminal: false, status: "queued" },
        {
            $set: { status: "published", publishedAt },
            $push: {
                messages: {
                    status: "published",
                    message: "Đã gửi MQTT",
                    error: null,
                    timestamp: Date.now(),
                    at: publishedAt,
                },
            },
        }
    );

    try {
        const fresh = await BotCommand.findOne({ requestId }).lean();
        if (!fresh || fresh.terminal) return BotCommand.findOne({ requestId });

        if (fresh.action === "APPLY_CONFIG") {
            const followers =
                Array.isArray(fresh.params?.followers) && fresh.params.followers.length
                    ? fresh.params.followers.map((e) => String(e).toUpperCase())
                    : await listReloadEnvs(fresh.targetEnv);
            if (!followers.includes(fresh.targetEnv)) followers.unshift(fresh.targetEnv);
            await publishConfigSync({
                source: fresh.targetEnv,
                targetEnv: fresh.targetEnv,
                followers,
                requestId: fresh.requestId,
                ts: Date.now(),
            });
        } else {
            const spec = ALLOWLIST[fresh.action];
            if (!spec || spec.kind !== "command") {
                throw new Error(`Action không publish được: ${fresh.action}`);
            }
            await publishNewCommand({
                command: fresh.mappedCommand || spec.mapCommand(fresh.targetEnv),
                cmdInfo: {
                    requestId: fresh.requestId,
                    source: "web",
                    targetEnv: fresh.targetEnv,
                    action: fresh.action,
                },
            });
        }
    } catch (error) {
        await BotCommand.updateOne(
            { requestId, terminal: false },
            {
                $set: {
                    status: "failed",
                    terminal: true,
                    error: { code: "MQTT_PUBLISH", message: error.message },
                },
                $push: {
                    messages: {
                        status: "failed",
                        message: error.message,
                        error: { code: "MQTT_PUBLISH", message: error.message },
                        timestamp: Date.now(),
                        at: new Date(),
                    },
                },
            }
        );
    }

    return BotCommand.findOne({ requestId });
}

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
        const after = await publishOutbox(doc);
        return publicCommand(after);
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
    await BotCommand.updateOne({ requestId: doc.requestId }, { $set: { attempt: (prev.attempt || 1) + 1 } });
    const after = await publishOutbox(doc);
    return publicCommand(after);
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
    const after = await publishOutbox(doc);
    return publicCommand(after);
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
    publishOutbox,
    resolveStatusTransition,
    evaluateRoleAcks,
    roleTerminalFromPayload,
};
