/**
 * Admin process env — mirror contract binance-bot bot_profile / commands.
 * Phase 1: gọi từ route đã gate admin.
 */
const BotProfile = require("../models/bot-profile");
const BotProfileRevision = require("../models/bot-profile-revision");
const BotControlCommand = require("../models/bot-control-command");
const ProcessHeartbeat = require("../models/process-heartbeat");
const MqttConfig = require("../models/mqtt-config");
const TelegramConfig = require("../models/telegram-config");
const TelegramClient = require("../models/telegram-client");
const {
    isForbiddenKey,
    isManagedKey,
    normalizeManagedValue,
    listRegistryEntries,
    BOOTSTRAP_KEYS,
} = require("./env-registry");
const { httpError } = require("./http");

const FORBIDDEN_VALUE = /(key|secret|password|token|uri|mongodb|redis|proxy)/i;
const HIGH_RISK = new Set([
    "TRADER",
    "MONITOR",
    "LISTENER",
    "RUN",
    "MQTT",
    "TELE",
    "TELE_CLIENT",
    "SERVER",
    "MAX_VOLUME",
]);

function shouldRedactKey(key) {
    if (!key) return true;
    if (isForbiddenKey(key)) return true;
    if (FORBIDDEN_VALUE.test(key)) return true;
    return false;
}

function redactValue(key, value) {
    if (value == null || value === "") return value;
    if (!shouldRedactKey(key)) return value;
    const s = String(value);
    if (s.length <= 4) return "***";
    return `${s.slice(0, 2)}***${s.slice(-1)}`;
}

function redactVariables(variables) {
    const out = {};
    if (!variables || typeof variables !== "object") return out;
    for (const [k, v] of Object.entries(variables)) {
        out[k] = shouldRedactKey(k) ? redactValue(k, v) : v;
    }
    return out;
}

function redactDiff(diff) {
    if (!Array.isArray(diff)) return [];
    return diff.map((item) => ({
        key: item.key,
        before: shouldRedactKey(item.key) ? redactValue(item.key, item.before) : item.before,
        after: shouldRedactKey(item.key) ? redactValue(item.key, item.after) : item.after,
    }));
}

function buildDiff(beforeVars, afterVars) {
    const keys = new Set([...Object.keys(beforeVars || {}), ...Object.keys(afterVars || {})]);
    const diff = [];
    for (const key of [...keys].sort()) {
        const before = beforeVars?.[key] ?? null;
        const after = afterVars?.[key] ?? null;
        if (String(before ?? "") === String(after ?? "")) continue;
        diff.push({ key, before, after });
    }
    return diff;
}

function mergePatch(currentVariables, patch, unsetKeys = []) {
    const next = { ...(currentVariables || {}) };
    for (const key of unsetKeys || []) {
        delete next[key];
    }
    for (const [rawKey, rawVal] of Object.entries(patch || {})) {
        const key = String(rawKey).trim();
        if (!key) continue;
        if (BOOTSTRAP_KEYS.has(key) || isForbiddenKey(key) || !isManagedKey(key)) {
            throw httpError(400, `Key không được phép: ${key}`);
        }
        const norm = normalizeManagedValue(key, rawVal);
        if (!norm.ok) throw httpError(400, norm.error);
        if (norm.value == null) delete next[key];
        else next[key] = norm.value;
    }
    const cleaned = {};
    for (const [k, v] of Object.entries(next)) {
        if (BOOTSTRAP_KEYS.has(k) || isForbiddenKey(k) || !isManagedKey(k)) continue;
        const norm = normalizeManagedValue(k, v);
        if (norm.ok && norm.value != null) cleaned[k] = norm.value;
    }
    return cleaned;
}

function validateRuntimeLike(variables) {
    const errors = [];
    const env = variables || {};
    if (!env.NODE_ENV) errors.push("NODE_ENV is required");
    const trader = ["true", "1", "yes"].includes(String(env.TRADER || "").toLowerCase());
    const monitor = ["true", "1", "yes"].includes(String(env.MONITOR || "").toLowerCase());
    const listener = ["true", "1", "yes"].includes(String(env.LISTENER || "").toLowerCase());
    const run = env.RUN
        ? String(env.RUN)
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
        : [];
    if ((trader || monitor) && run.length === 0) {
        errors.push("RUN is required when TRADER or MONITOR is enabled");
    }
    if (listener && !env.TELE_CLIENT && !env.DISCORD) {
        errors.push("TELE_CLIENT or DISCORD required when LISTENER is enabled");
    }
    if (env.TELE_CLIENT_VERSION && !["1", "2"].includes(String(env.TELE_CLIENT_VERSION))) {
        errors.push("TELE_CLIENT_VERSION chỉ 1 hoặc 2");
    }
    return errors;
}

async function validateReferences(variables) {
    const errors = [];
    const env = variables || {};
    if (env.MQTT) {
        const row = await MqttConfig.findOne({ env: String(env.MQTT).toUpperCase() })
            .select({ env: 1 })
            .lean();
        if (!row) errors.push(`MQTT env "${env.MQTT}" không có trong mqtt-config`);
    }
    if (env.TELE) {
        const row = await TelegramConfig.findOne({ env: String(env.TELE).toUpperCase() })
            .select({ env: 1 })
            .lean();
        if (!row) errors.push(`TELE env "${env.TELE}" không có trong telegram-config`);
    }
    if (env.TELE_CLIENT) {
        const row = await TelegramClient.findOne({ env: String(env.TELE_CLIENT) })
            .select({ env: 1 })
            .lean();
        if (!row) errors.push(`TELE_CLIENT "${env.TELE_CLIENT}" không có trong telegram-client`);
    }
    return errors;
}

function matchProfileKey(beat, profilesByEnv) {
    const candidates = [beat.botEnv, beat.processName, beat.nodeEnv]
        .map((v) => String(v || "").trim().toUpperCase())
        .filter(Boolean);
    for (const key of candidates) {
        if (profilesByEnv.has(key)) return key;
    }
    return null;
}

async function loadProfileMaps() {
    const [profiles, commands] = await Promise.all([
        BotProfile.find({}).lean(),
        BotControlCommand.find({
            status: { $in: ["queued", "claimed", "restarting", "waiting_heartbeat"] },
        })
            .sort({ createdAt: -1 })
            .limit(200)
            .lean(),
    ]);
    const profilesByEnv = new Map(profiles.map((p) => [String(p.env).toUpperCase(), p]));
    const lastCommandByEnv = new Map();
    for (const cmd of commands) {
        const key = String(cmd.profileEnv || "").toUpperCase();
        if (!key || lastCommandByEnv.has(key)) continue;
        lastCommandByEnv.set(key, {
            id: String(cmd._id),
            status: cmd.status,
            kind: cmd.kind,
            statusReason: cmd.statusReason || "",
        });
    }
    return { profilesByEnv, lastCommandByEnv };
}

function enrichProcessRow(beatPublic, profilesByEnv, lastCommandByEnv) {
    const profileEnv = matchProfileKey(beatPublic, profilesByEnv);
    const profile = profileEnv ? profilesByEnv.get(profileEnv) : null;
    const desiredRevision = profile ? Number(profile.revision) || 1 : null;
    const actualRevision =
        beatPublic.profileRevision != null ? Number(beatPublic.profileRevision) : null;
    let drift = null;
    if (!profile) drift = "no_profile";
    else if (beatPublic.status === "down") drift = "stale";
    else if (actualRevision == null) drift = "unknown";
    else if (desiredRevision !== actualRevision) drift = "mismatch";
    else drift = "ok";

    return {
        ...beatPublic,
        botEnv: beatPublic.botEnv || beatPublic.profileEnv || "",
        hostId: beatPublic.hostId || "",
        profileEnv: profileEnv || null,
        profileActive: profile ? profile.active !== false : null,
        desiredRevision,
        actualRevision,
        drift,
        lastCommand: profileEnv ? lastCommandByEnv.get(profileEnv) || null : null,
    };
}

async function getRegistry() {
    return listRegistryEntries();
}

async function getReferenceOptions() {
    const [mqtt, tele, clients] = await Promise.all([
        MqttConfig.find({}).select({ env: 1 }).lean(),
        TelegramConfig.find({}).select({ env: 1 }).lean(),
        TelegramClient.find({}).select({ env: 1 }).lean(),
    ]);
    return {
        mqtt: mqtt.map((r) => r.env).filter(Boolean).sort(),
        tele: tele.map((r) => r.env).filter(Boolean).sort(),
        teleClient: clients.map((r) => r.env).filter(Boolean).sort(),
    };
}

async function getProfileDetail(env) {
    const key = String(env || "").toUpperCase();
    const profile = await BotProfile.findOne({ env: key }).lean();
    if (!profile) throw httpError(404, `Profile ${key} không tồn tại`);

    const heartbeat = await ProcessHeartbeat.findOne({
        $or: [{ botEnv: key }, { processName: new RegExp(`^${escapeRegex(key)}$`, "i") }, { nodeEnv: key }],
    })
        .sort({ at: -1 })
        .lean();

    return {
        env: profile.env,
        label: profile.label || "",
        active: profile.active !== false,
        revision: Number(profile.revision) || 1,
        updatedAt: profile.updatedAt,
        updatedBy: profile.updatedBy || null,
        variables: redactVariables(profile.variables || {}),
        highRiskKeys: [...HIGH_RISK],
        status: {
            processName: heartbeat?.processName || profile.env,
            hostId: heartbeat?.hostId || "",
            host: heartbeat?.host || "",
            pid: heartbeat?.pid || null,
            at: heartbeat?.at || null,
            actualRevision: heartbeat?.profileRevision != null ? Number(heartbeat.profileRevision) : null,
            lastStartupError: heartbeat?.lastStartupError || "",
            startedAt: heartbeat?.startedAt || null,
            mqttConnected: heartbeat?.mqttConnected,
        },
    };
}

function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function listRevisions(env, { limit = 40 } = {}) {
    const key = String(env || "").toUpperCase();
    const rows = await BotProfileRevision.find({ profileEnv: key })
        .sort({ revision: -1 })
        .limit(limit)
        .lean();
    return rows.map((r) => ({
        profileEnv: r.profileEnv,
        revision: r.revision,
        action: r.action,
        reason: r.reason,
        actor: r.actor,
        createdAt: r.createdAt,
        diff: redactDiff(r.diff || []),
        variables: redactVariables(r.variables || {}),
    }));
}

async function patchProfile(env, input, actor) {
    const key = String(env || "").toUpperCase();
    const expectedRevision = Number(input.expectedRevision);
    if (!Number.isFinite(expectedRevision)) throw httpError(400, "expectedRevision bắt buộc");
    if (!input.reason || !String(input.reason).trim()) throw httpError(400, "reason bắt buộc");

    const current = await BotProfile.findOne({ env: key }).lean();
    if (!current) throw httpError(404, `Profile ${key} không tồn tại`);
    if (Number(current.revision || 1) !== expectedRevision) {
        const err = httpError(409, `Revision conflict: expected ${expectedRevision}, current ${current.revision}`);
        err.current = {
            env: current.env,
            revision: current.revision,
            variables: redactVariables(current.variables || {}),
        };
        throw err;
    }

    const nextVariables = mergePatch(current.variables || {}, input.patch || {}, input.unset || []);
    if (input.label != null) {
        /* label applied on $set below */
    }
    const errors = [...validateRuntimeLike(nextVariables), ...(await validateReferences(nextVariables))];
    const diff = buildDiff(current.variables || {}, nextVariables);

    if (input.dryRun) {
        return {
            ok: errors.length === 0,
            dryRun: true,
            env: key,
            expectedRevision,
            nextRevision: expectedRevision + 1,
            diff: redactDiff(diff),
            variables: redactVariables(nextVariables),
            errors,
            highRiskTouched: diff.some((d) => HIGH_RISK.has(d.key)),
        };
    }
    if (errors.length) {
        const err = httpError(400, "Profile không hợp lệ");
        err.errors = errors;
        throw err;
    }

    const nextRevision = expectedRevision + 1;
    const actorDoc = {
        userId: String(actor?.id || actor?.userId || ""),
        email: String(actor?.email || ""),
    };
    const $set = {
        variables: nextVariables,
        revision: nextRevision,
        updatedBy: actorDoc,
        updatedAt: new Date(),
    };
    if (input.label != null) $set.label = String(input.label);
    if (input.active != null) $set.active = !!input.active;

    const updated = await BotProfile.findOneAndUpdate(
        { env: key, revision: expectedRevision },
        { $set },
        { new: true, lean: true }
    );
    if (!updated) throw httpError(409, "Revision conflict khi ghi");

    await BotProfileRevision.create({
        profileEnv: key,
        revision: nextRevision,
        action: "update",
        variables: nextVariables,
        diff,
        reason: String(input.reason).trim(),
        actor: actorDoc,
        createdAt: new Date(),
    });

    return {
        ok: true,
        env: key,
        revision: nextRevision,
        diff: redactDiff(diff),
        variables: redactVariables(nextVariables),
    };
}

async function rollbackProfile(env, input, actor) {
    const key = String(env || "").toUpperCase();
    const toRevision = Number(input.toRevision);
    const expectedRevision = Number(input.expectedRevision);
    if (!input.reason || !String(input.reason).trim()) throw httpError(400, "reason bắt buộc");

    const snapshot = await BotProfileRevision.findOne({ profileEnv: key, revision: toRevision }).lean();
    if (!snapshot) throw httpError(404, `Không có snapshot revision ${toRevision}`);

    const current = await BotProfile.findOne({ env: key }).lean();
    if (!current) throw httpError(404, `Profile ${key} không tồn tại`);
    if (Number(current.revision || 1) !== expectedRevision) {
        throw httpError(409, `Revision conflict: expected ${expectedRevision}, current ${current.revision}`);
    }

    const nextVariables = { ...(snapshot.variables || {}) };
    const errors = [...validateRuntimeLike(nextVariables), ...(await validateReferences(nextVariables))];
    if (errors.length) {
        const err = httpError(400, "Snapshot rollback không hợp lệ");
        err.errors = errors;
        throw err;
    }

    const nextRevision = expectedRevision + 1;
    const diff = buildDiff(current.variables || {}, nextVariables);
    const actorDoc = {
        userId: String(actor?.id || actor?.userId || ""),
        email: String(actor?.email || ""),
    };

    const updated = await BotProfile.findOneAndUpdate(
        { env: key, revision: expectedRevision },
        {
            $set: {
                variables: nextVariables,
                revision: nextRevision,
                updatedBy: actorDoc,
                updatedAt: new Date(),
            },
        },
        { new: true, lean: true }
    );
    if (!updated) throw httpError(409, "Revision conflict khi rollback");

    await BotProfileRevision.create({
        profileEnv: key,
        revision: nextRevision,
        action: "rollback",
        variables: nextVariables,
        diff,
        reason: String(input.reason).trim(),
        actor: actorDoc,
        createdAt: new Date(),
    });

    return {
        ok: true,
        env: key,
        revision: nextRevision,
        rolledBackFrom: toRevision,
        diff: redactDiff(diff),
        variables: redactVariables(nextVariables),
    };
}

async function createCommand(env, input, actor) {
    const key = String(env || "").toUpperCase();
    const kind = input.kind === "reload" ? "reload" : "restart";
    const reason = String(input.reason || "").trim();
    if (!reason) throw httpError(400, "reason bắt buộc");

    const profile = await BotProfile.findOne({ env: key }).lean();
    if (!profile) throw httpError(404, `Profile ${key} không tồn tại`);
    if (profile.active === false) throw httpError(400, `Profile ${key} inactive`);

    const requestedRevision = Number(input.requestedRevision ?? profile.revision ?? 1);
    if (Number(profile.revision || 1) !== requestedRevision) {
        throw httpError(400, `requestedRevision ${requestedRevision} ≠ profile ${profile.revision}`);
    }

    const heartbeat = await ProcessHeartbeat.findOne({
        $or: [{ botEnv: key }, { processName: new RegExp(`^${escapeRegex(key)}$`, "i") }],
    })
        .sort({ at: -1 })
        .lean();

    const hostId = String(input.hostId || heartbeat?.hostId || "").trim();
    if (!hostId) {
        throw httpError(
            400,
            "Thiếu hostId — cấu hình BOT_CONTROL_HOST_ID trên process bot rồi đợi heartbeat"
        );
    }
    const processName = String(input.processName || heartbeat?.processName || profile.env).trim();

    const doc = await BotControlCommand.create({
        kind,
        hostId,
        processName,
        profileEnv: key,
        requestedRevision,
        requestedBy: {
            userId: String(actor?.id || actor?.userId || ""),
            email: String(actor?.email || ""),
        },
        reason,
        status: "queued",
        createdAt: new Date(),
        updatedAt: new Date(),
    });

    return sanitizeCommand(doc.toObject ? doc.toObject() : doc);
}

async function getCommand(id) {
    const doc = await BotControlCommand.findById(id).lean();
    if (!doc) throw httpError(404, "Command không tồn tại");
    return sanitizeCommand(doc);
}

async function listCommandsForEnv(env, { limit = 20 } = {}) {
    const key = String(env || "").toUpperCase();
    const rows = await BotControlCommand.find({ profileEnv: key })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
    return rows.map(sanitizeCommand);
}

function sanitizeCommand(doc) {
    if (!doc) return null;
    const result = doc.result
        ? {
              ...doc.result,
              stdout: String(doc.result.stdout || "").slice(0, 500),
              stderr: String(doc.result.stderr || "").slice(0, 500),
              error: String(doc.result.error || "").slice(0, 300),
          }
        : null;
    return {
        id: String(doc._id),
        kind: doc.kind,
        hostId: doc.hostId,
        processName: doc.processName,
        profileEnv: doc.profileEnv,
        requestedRevision: doc.requestedRevision,
        requestedBy: doc.requestedBy,
        reason: doc.reason,
        status: doc.status,
        statusReason: doc.statusReason || "",
        createdAt: doc.createdAt,
        claimedAt: doc.claimedAt,
        completedAt: doc.completedAt,
        result,
    };
}

module.exports = {
    shouldRedactKey,
    redactVariables,
    redactDiff,
    mergePatch,
    validateRuntimeLike,
    loadProfileMaps,
    enrichProcessRow,
    matchProfileKey,
    getRegistry,
    getReferenceOptions,
    getProfileDetail,
    listRevisions,
    patchProfile,
    rollbackProfile,
    createCommand,
    getCommand,
    listCommandsForEnv,
    HIGH_RISK,
};
