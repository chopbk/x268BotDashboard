const AuditLog = require("../models/audit-log");

const NEVER_LOG_FIELDS = new Set([
    "password",
    "passwordHash",
    "token",
    "jwt",
    "secret",
    "apiKey",
    "apiSecret",
    "api_key",
    "api_secret",
]);

function identity(user, type = "user") {
    if (!user) return { type: "system", name: "System" };
    return {
        id: user._id || user.id ? String(user._id || user.id) : undefined,
        email: user.email || undefined,
        username: user.username || undefined,
        name: user.name || undefined,
        type,
    };
}

function maskPhone(value) {
    if (!value) return null;
    const text = String(value);
    return `***${text.slice(-4)}`;
}

function sanitizeAuditValue(field, value) {
    if (NEVER_LOG_FIELDS.has(field)) return undefined;
    if (field === "phone") return maskPhone(value);
    if (Array.isArray(value)) return [...value];
    if (value && typeof value === "object") return JSON.parse(JSON.stringify(value));
    return value ?? null;
}

function buildChanges(before, after, fields) {
    const changes = {};
    for (const field of fields) {
        if (NEVER_LOG_FIELDS.has(field)) continue;
        const previous = sanitizeAuditValue(field, before?.[field]);
        const next = sanitizeAuditValue(field, after?.[field]);
        if (JSON.stringify(previous) !== JSON.stringify(next)) {
            changes[field] = { from: previous, to: next };
        }
    }
    return changes;
}

async function recordAudit({ action, actor, targetType, target, changes = {} }) {
    return AuditLog.create({
        action,
        actor: identity(actor),
        targetType,
        target: identity(target),
        changes,
    });
}

async function safeRecordAudit(entry) {
    try {
        await recordAudit(entry);
    } catch (error) {
        console.error("[audit] không ghi được audit log", error);
    }
}

module.exports = {
    NEVER_LOG_FIELDS,
    identity,
    maskPhone,
    sanitizeAuditValue,
    buildChanges,
    recordAudit,
    safeRecordAudit,
};
