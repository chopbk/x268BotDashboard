const { ROLES } = require("../auth/access-control");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const ROLE_SET = new Set(ROLES);

function normalizeEmail(value) {
    return String(value || "")
        .trim()
        .toLowerCase();
}

function isValidEmail(email) {
    return EMAIL_RE.test(email);
}

function normalizeUsername(value) {
    return String(value || "")
        .trim()
        .toLowerCase();
}

function isValidUsername(username) {
    return USERNAME_RE.test(username);
}

function normalizeTelegramUsername(value) {
    return String(value || "")
        .trim()
        .replace(/^@/, "")
        .toLowerCase();
}

function isValidTelegramUsername(value) {
    return !value || /^[a-z][a-z0-9_]{4,31}$/.test(value);
}

function normalizePhone(value) {
    return String(value || "")
        .trim()
        .replace(/[\s().-]/g, "")
        .replace(/^00/, "+");
}

function isValidPhone(value) {
    return !value || /^\+?[1-9]\d{6,14}$/.test(value);
}

function normalizeTelegramId(value) {
    return String(value || "").trim();
}

function isValidTelegramId(value) {
    return !value || /^\d{5,20}$/.test(value);
}

function parseBotUsernames(value) {
    if (!Array.isArray(value)) return { error: "botUsernames phải là mảng" };
    const names = [];
    const seen = new Set();
    for (const item of value) {
        if (typeof item !== "string") return { error: "Mỗi bot username phải là chuỗi" };
        const name = item.trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        names.push(name);
    }
    return { names };
}

function isRole(value) {
    return ROLE_SET.has(value);
}

module.exports = {
    normalizeEmail,
    isValidEmail,
    normalizeUsername,
    isValidUsername,
    normalizeTelegramUsername,
    isValidTelegramUsername,
    normalizePhone,
    isValidPhone,
    normalizeTelegramId,
    isValidTelegramId,
    parseBotUsernames,
    isRole,
};
