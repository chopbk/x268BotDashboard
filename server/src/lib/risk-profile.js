const WebUser = require("../models/web-user");
const { httpError } = require("./http");

const STYLES = new Set(["scalp", "intraday", "swing"]);
const UNITS = new Set(["usdt", "pct_equity"]);

function numOrNull(value) {
    if (value == null || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function normalizeBudget(raw) {
    if (raw == null || raw === false) return null;
    if (typeof raw !== "object") return null;
    const value = numOrNull(raw.value);
    const unit = String(raw.unit || "").toLowerCase();
    if (value == null || value < 0) return null;
    if (!UNITS.has(unit)) return null;
    if (unit === "pct_equity" && value > 100) return null;
    return { value, unit };
}

function boolOrNull(value) {
    if (value === true || value === false) return value;
    if (value == null || value === "") return null;
    return null;
}

function emptyProfile() {
    return {
        style: null,
        maxLossPerTrade: null,
        maxLossAccount: null,
        maxLossDay: null,
        maxSymbolConcentrationPct: null,
        allowHoldThroughFunding: null,
        allowDca: null,
        allowAddPosition: null,
        updatedAt: null,
    };
}

function serializeProfile(doc) {
    const base = emptyProfile();
    if (!doc || typeof doc !== "object") return base;
    return {
        style: STYLES.has(doc.style) ? doc.style : null,
        maxLossPerTrade: normalizeBudget(doc.maxLossPerTrade),
        maxLossAccount: normalizeBudget(doc.maxLossAccount),
        maxLossDay: normalizeBudget(doc.maxLossDay),
        maxSymbolConcentrationPct: (() => {
            const n = numOrNull(doc.maxSymbolConcentrationPct);
            if (n == null || n < 0 || n > 100) return null;
            return n;
        })(),
        allowHoldThroughFunding: boolOrNull(doc.allowHoldThroughFunding),
        allowDca: boolOrNull(doc.allowDca),
        allowAddPosition: boolOrNull(doc.allowAddPosition),
        updatedAt: doc.updatedAt || null,
    };
}

function isConfigured(profile) {
    const p = serializeProfile(profile);
    return Boolean(
        p.style
        || p.maxLossPerTrade
        || p.maxLossAccount
        || p.maxLossDay
        || p.maxSymbolConcentrationPct != null
        || p.allowHoldThroughFunding != null
        || p.allowDca != null
        || p.allowAddPosition != null
    );
}

function normalizeInput(body = {}) {
    const next = emptyProfile();
    if (body.style != null && body.style !== "") {
        const style = String(body.style).toLowerCase();
        if (!STYLES.has(style)) throw httpError(400, "style phải là scalp|intraday|swing");
        next.style = style;
    }
    if (Object.prototype.hasOwnProperty.call(body, "maxLossPerTrade")) {
        next.maxLossPerTrade = body.maxLossPerTrade == null ? null : normalizeBudget(body.maxLossPerTrade);
        if (body.maxLossPerTrade != null && next.maxLossPerTrade == null) {
            throw httpError(400, "maxLossPerTrade không hợp lệ (value + unit usdt|pct_equity)");
        }
    }
    if (Object.prototype.hasOwnProperty.call(body, "maxLossAccount")) {
        next.maxLossAccount = body.maxLossAccount == null ? null : normalizeBudget(body.maxLossAccount);
        if (body.maxLossAccount != null && next.maxLossAccount == null) {
            throw httpError(400, "maxLossAccount không hợp lệ");
        }
    }
    if (Object.prototype.hasOwnProperty.call(body, "maxLossDay")) {
        next.maxLossDay = body.maxLossDay == null ? null : normalizeBudget(body.maxLossDay);
        if (body.maxLossDay != null && next.maxLossDay == null) {
            throw httpError(400, "maxLossDay không hợp lệ");
        }
    }
    if (Object.prototype.hasOwnProperty.call(body, "maxSymbolConcentrationPct")) {
        if (body.maxSymbolConcentrationPct == null || body.maxSymbolConcentrationPct === "") {
            next.maxSymbolConcentrationPct = null;
        } else {
            const n = numOrNull(body.maxSymbolConcentrationPct);
            if (n == null || n < 0 || n > 100) throw httpError(400, "maxSymbolConcentrationPct phải trong 0–100");
            next.maxSymbolConcentrationPct = n;
        }
    }
    if (Object.prototype.hasOwnProperty.call(body, "allowHoldThroughFunding")) {
        next.allowHoldThroughFunding = boolOrNull(body.allowHoldThroughFunding);
    }
    if (Object.prototype.hasOwnProperty.call(body, "allowDca")) {
        next.allowDca = boolOrNull(body.allowDca);
    }
    if (Object.prototype.hasOwnProperty.call(body, "allowAddPosition")) {
        next.allowAddPosition = boolOrNull(body.allowAddPosition);
    }
    next.updatedAt = new Date().toISOString();
    return next;
}

async function getRiskProfile(actor) {
    const user = await WebUser.findById(actor.id).select("riskProfile").lean();
    if (!user) throw httpError(401, "Chưa đăng nhập");
    const profile = serializeProfile(user.riskProfile);
    return { profile, configured: isConfigured(profile) };
}

async function putRiskProfile(actor, body) {
    const user = await WebUser.findById(actor.id);
    if (!user || user.disabled) throw httpError(401, "Chưa đăng nhập");
    const input = body || {};
    const next = serializeProfile(user.riskProfile);
    const patch = normalizeInput(input);
    for (const key of Object.keys(emptyProfile())) {
        if (key === "updatedAt") continue;
        if (Object.prototype.hasOwnProperty.call(input, key)) next[key] = patch[key];
    }
    next.updatedAt = new Date().toISOString();
    user.riskProfile = next;
    await user.save();
    return { profile: serializeProfile(user.riskProfile), configured: isConfigured(user.riskProfile) };
}

module.exports = {
    STYLES,
    UNITS,
    emptyProfile,
    serializeProfile,
    isConfigured,
    normalizeInput,
    getRiskProfile,
    putRiskProfile,
};
