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

/** action → { kind, permission, mapCommand?, requiredRoles?, clientExposed? } */
const ALLOWLIST = Object.freeze({
    APPLY_CONFIG: {
        kind: "config_sync",
        permission: PERMISSIONS.CONFIG_EDIT,
        requiredRoles: ["TRADER"],
        clientExposed: true,
    },
    /** Chỉ hook sau POST/PATCH/DELETE account — không qua POST .../commands. */
    LOAD_ACCOUNT: {
        kind: "account_runtime",
        runtimeAction: "load",
        permission: PERMISSIONS.CONFIG_EDIT,
        requiredRoles: ["TRADER"],
        clientExposed: false,
    },
    UNLOAD_ACCOUNT: {
        kind: "account_runtime",
        runtimeAction: "unload",
        permission: PERMISSIONS.CONFIG_EDIT,
        requiredRoles: ["TRADER"],
        clientExposed: false,
    },
    RENAME_ACCOUNT: {
        kind: "account_runtime",
        runtimeAction: "rename",
        permission: PERMISSIONS.CONFIG_EDIT,
        requiredRoles: ["TRADER"],
        clientExposed: false,
    },
});

function normalizeAccountList(list) {
    if (!Array.isArray(list)) return [];
    return [...new Set(list.map((a) => String(a || "").toUpperCase()).filter(Boolean))];
}

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
            ackChannel: m.ackChannel || null,
        })),
        error: doc.error || null,
        publishedAt: doc.publishedAt,
        expiresAt: doc.expiresAt,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        attempt: doc.attempt,
        retryOfRequestId: doc.retryOfRequestId || null,
        lastAckChannel: doc.lastAckChannel || null,
    };
}

async function listReloadEnvs(targetEnv) {
    const env = String(targetEnv || "").toUpperCase();
    if (!env) return [];
    // Dùng collection native: tránh strictQuery strip `sync_from` nếu schema lệch.
    // Case-insensitive vì sync_from/env trên Mongo có thể không đồng nhất chữ hoa.
    const followers = await AccountConfig.collection
        .find({ sync_from: { $regex: `^${env.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" } })
        .project({ env: 1 })
        .toArray();
    const names = [env];
    for (const row of followers) {
        const fol = String(row?.env || "").toUpperCase();
        if (fol && !names.includes(fol)) names.push(fol);
    }
    return names;
}

/**
 * @param {object} [accessOpts]
 * @param {string[]} [accessOpts.previousAccounts] — snapshot accounts trước mutation (UNLOAD/RENAME)
 * @param {string} [accessOpts.fromEnv] — env cũ khi RENAME
 */
async function assertActionAccess(actor, username, targetEnv, action, accessOpts = {}) {
    const spec = ALLOWLIST[action];
    if (!spec) throw httpError(400, `Action không được phép: ${action}`);
    if (!hasPermission(actor, spec.permission)) {
        throw httpError(403, "Không có quyền");
    }
    const bot = await requireBot(actor, username, spec.permission);
    const env = String(targetEnv || "").toUpperCase();
    const accounts = (bot.accounts || []).map((a) => String(a).toUpperCase());
    const previousAccounts = normalizeAccountList(
        accessOpts.previousAccounts || accessOpts.params?.previousAccounts
    );

    if (action === "UNLOAD_ACCOUNT") {
        if (!previousAccounts.includes(env)) {
            throw httpError(403, "UNLOAD yêu cầu bằng chứng account từng thuộc bot");
        }
        return { bot, env, spec, previousAccounts };
    }

    if (action === "RENAME_ACCOUNT") {
        const fromEnv = String(accessOpts.fromEnv || accessOpts.params?.fromEnv || "").toUpperCase();
        if (!fromEnv) throw httpError(400, "Thiếu fromEnv");
        if (!previousAccounts.includes(fromEnv)) {
            throw httpError(403, "RENAME yêu cầu bằng chứng fromEnv từng thuộc bot");
        }
        if (!accounts.includes(env)) {
            throw httpError(404, `Không có account ${env}`);
        }
        return { bot, env, spec, fromEnv, previousAccounts };
    }

    if (!accounts.includes(env)) {
        throw httpError(404, `Không có account ${env}`);
    }
    return { bot, env, spec, previousAccounts };
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
        const requireApplied = [
            "APPLY_CONFIG",
            "LOAD_ACCOUNT",
            "UNLOAD_ACCOUNT",
            "RENAME_ACCOUNT",
        ].includes(doc.action);
        const roleResult = roleTerminalFromPayload(payload, doc.targetEnv, { requireApplied });
        if (!roleResult) return;

        const msgEntry = {
            status: roleResult.status,
            message: roleResult.message == null ? "" : String(roleResult.message),
            error: roleResult.error || null,
            processRole,
            instanceId: payload.instanceId ? String(payload.instanceId) : "",
            timestamp: payload.timestamp || Date.now(),
            at: new Date(),
            ackChannel: "mqtt",
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
            lastAckChannel: "mqtt",
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
    accessOpts = {},
    retryOfRequestId = null,
}) {
    const access = await assertActionAccess(actor, username, targetEnv, action, {
        ...accessOpts,
        params,
    });
    const { bot, env, spec } = access;
    const requestId = crypto.randomUUID();
    const mappedCommand = spec.kind === "command" ? spec.mapCommand(env) : "";
    const safeParams = params && typeof params === "object" ? { ...params } : {};
    if (access.previousAccounts?.length && !safeParams.previousAccounts) {
        safeParams.previousAccounts = access.previousAccounts;
    }
    if (access.fromEnv && !safeParams.fromEnv) {
        safeParams.fromEnv = access.fromEnv;
    }
    const doc = await BotCommand.create({
        requestId,
        username: bot.username || normalizeName(username),
        targetEnv: env,
        action,
        params: safeParams,
        mappedCommand,
        status: "queued",
        terminal: false,
        requiredRoles: spec.requiredRoles ? [...spec.requiredRoles] : ["TRADER"],
        roleAcks: {},
        actorUserId: actor?.id || (actor?._id ? String(actor._id) : ""),
        actorUsername: actor?.username || actor?.email || "",
        expiresAt: new Date(Date.now() + ttlMs),
        attempt: 1,
        retryOfRequestId: retryOfRequestId || null,
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

        const spec = ALLOWLIST[fresh.action];
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
        } else if (spec?.kind === "account_runtime") {
            const runtimeAction = spec.runtimeAction || fresh.params?.runtimeAction || "load";
            await publishConfigSync({
                type: "account_runtime",
                action: runtimeAction,
                username: fresh.username,
                env:
                    runtimeAction === "rename"
                        ? String(fresh.params?.fromEnv || fresh.targetEnv).toUpperCase()
                        : fresh.targetEnv,
                nextEnv: runtimeAction === "rename" ? fresh.targetEnv : undefined,
                requestId: fresh.requestId,
                ts: Date.now(),
            });
        } else if (spec?.kind === "command") {
            await publishNewCommand({
                command: fresh.mappedCommand || spec.mapCommand(fresh.targetEnv),
                cmdInfo: {
                    requestId: fresh.requestId,
                    source: "web",
                    targetEnv: fresh.targetEnv,
                    action: fresh.action,
                },
            });
        } else {
            throw new Error(`Action không publish được: ${fresh.action}`);
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

/**
 * Đồng bộ account runtime — chỉ gọi từ route mutation account (không từ POST /commands).
 * @param {object} [proof]
 * @param {string[]} [proof.previousAccounts] bắt buộc với UNLOAD/RENAME
 * @param {string} [proof.mutationId] id audit tùy chọn
 */
async function enqueueAccountRuntime(actor, username, action, env, nextEnv = "", proof = {}) {
    try {
        bindResponseListener();
        const act = String(action || "").toUpperCase();
        if (!["LOAD_ACCOUNT", "UNLOAD_ACCOUNT", "RENAME_ACCOUNT"].includes(act)) {
            throw httpError(400, `Action account không hợp lệ: ${action}`);
        }
        const from = String(env || "").toUpperCase();
        const to = String(nextEnv || "").toUpperCase();
        const targetEnv = act === "RENAME_ACCOUNT" ? to || from : from;
        const previousAccounts = normalizeAccountList(proof.previousAccounts);
        if ((act === "UNLOAD_ACCOUNT" || act === "RENAME_ACCOUNT") && !previousAccounts.includes(from)) {
            throw httpError(403, "Thiếu bằng chứng account thuộc bot trước mutation");
        }
        const params = {
            runtimeAction: ALLOWLIST[act].runtimeAction,
            previousAccounts: previousAccounts.length ? previousAccounts : undefined,
            mutationId: proof.mutationId || undefined,
        };
        if (act === "RENAME_ACCOUNT") {
            params.fromEnv = from;
            params.nextEnv = to;
        }
        const doc = await createOutbox({
            actor,
            username,
            targetEnv,
            action: act,
            params,
            accessOpts: { previousAccounts, fromEnv: from },
        });
        const after = await publishOutbox(doc);
        return publicCommand(after);
    } catch (error) {
        console.error("[enqueueAccountRuntime]", error.message);
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

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Đọc outbox theo requestId. Source of truth là Mongo (bot ghi ACK trực tiếp).
 * @param {object} [opts]
 * @param {number} [opts.waitMs] — chờ ngắn trên server đến khi terminal hoặc hết giờ (max 30s)
 */
async function getCommand(actor, requestId, opts = {}) {
    const waitMs = Math.min(Math.max(Number(opts.waitMs) || 0, 0), 30_000);
    await markExpired();
    let doc = await BotCommand.findOne({ requestId: String(requestId || "") });
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

    if (waitMs > 0 && !doc.terminal) {
        const deadline = Date.now() + waitMs;
        while (!doc.terminal && Date.now() < deadline) {
            await sleep(400);
            await markExpired();
            doc = await BotCommand.findOne({ requestId: String(requestId || "") });
            if (!doc) throw httpError(404, "Không tìm thấy lệnh");
        }
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
    const action = String(prev.action || "APPLY_CONFIG").toUpperCase();
    if (!ALLOWLIST[action]) throw httpError(400, `Action không được phép: ${action}`);

    const retryOfRequestId = prev.requestId;
    let params = {};
    let accessOpts = {};

    if (action === "APPLY_CONFIG") {
        const followers =
            Array.isArray(prev.params?.followers) && prev.params.followers.length
                ? prev.params.followers.map((e) => String(e).toUpperCase())
                : await listReloadEnvs(targetEnv);
        params = { followers };
    } else if (ALLOWLIST[action].kind === "account_runtime") {
        const previousAccounts = normalizeAccountList(prev.params?.previousAccounts);
        const fromEnv = String(prev.params?.fromEnv || (action === "RENAME_ACCOUNT" ? "" : prev.targetEnv)).toUpperCase();
        const nextEnv = String(prev.params?.nextEnv || (action === "RENAME_ACCOUNT" ? prev.targetEnv : "")).toUpperCase();
        params = {
            runtimeAction: ALLOWLIST[action].runtimeAction,
            previousAccounts: previousAccounts.length ? previousAccounts : undefined,
            mutationId: prev.params?.mutationId,
        };
        if (action === "RENAME_ACCOUNT") {
            params.fromEnv = fromEnv;
            params.nextEnv = nextEnv || String(targetEnv).toUpperCase();
        }
        accessOpts = { previousAccounts, fromEnv: fromEnv || undefined };
    } else {
        params = prev.params && typeof prev.params === "object" ? { ...prev.params } : {};
    }

    const doc = await createOutbox({
        actor,
        username,
        targetEnv,
        action,
        params,
        accessOpts,
        retryOfRequestId,
    });
    await BotCommand.updateOne(
        { requestId: doc.requestId },
        { $set: { attempt: (prev.attempt || 1) + 1, retryOfRequestId } }
    );
    const after = await publishOutbox(doc);
    return publicCommand(after);
}

async function dispatchCommand(actor, username, targetEnv, body) {
    const action = String(body?.action || "").trim().toUpperCase();
    if (!ALLOWLIST[action]) throw httpError(400, `Action không được phép: ${action}`);
    if (ALLOWLIST[action].clientExposed === false) {
        throw httpError(400, "Action account chỉ dùng nội bộ sau thêm/xóa/đổi tên account");
    }
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
    normalizeAccountList,
    publicCommand,
    listReloadEnvs,
    enqueueApplyConfig,
    enqueueApplyConfigMany,
    enqueueAccountRuntime,
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
