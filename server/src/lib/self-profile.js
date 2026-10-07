const WebUser = require("../models/web-user");
const { PERMISSIONS, hasPermission } = require("../auth/access-control");
const { hashPassword, verifyPassword } = require("../auth/password");
const { httpError } = require("./http");
const { sessionUser } = require("./public-user");
const { buildChanges, safeRecordAudit } = require("./audit");
const {
    normalizeTelegramUsername,
    isValidTelegramUsername,
    normalizePhone,
    isValidPhone,
    normalizeTelegramId,
    isValidTelegramId,
} = require("./validate");

const AUDITED_FIELDS = ["name", "telegramId", "telegramUsername", "phone"];

function has(body, key) {
    return Object.prototype.hasOwnProperty.call(body || {}, key);
}

async function updateSelfProfile(actor, input = {}) {
    const body = input || {};
    const hasName = has(body, "name");
    const hasTelegramId = has(body, "telegramId");
    const hasTelegramUsername = has(body, "telegramUsername");
    const hasPhone = has(body, "phone");
    const hasPassword = has(body, "password") && body.password;
    const profileChange = hasName || hasTelegramId || hasTelegramUsername || hasPhone;
    if (!profileChange && !hasPassword) throw httpError(400, "Không có dữ liệu để cập nhật");
    if (profileChange && !hasPermission(actor, PERMISSIONS.USERS_EDIT)) throw httpError(403, "Không có quyền sửa hồ sơ");
    if (hasPassword && !hasPermission(actor, PERMISSIONS.USERS_RESET_PASSWORD)) throw httpError(403, "Không có quyền đổi mật khẩu");
    if (has(body, "email") && body.email !== actor.email) throw httpError(400, "Không đổi email tại hồ sơ");
    if (has(body, "username") && body.username !== actor.username) throw httpError(400, "Không đổi username tại hồ sơ");

    const user = await WebUser.findById(actor.id);
    if (!user || user.disabled) throw httpError(401, "Chưa đăng nhập");
    const before = {
        name: user.name,
        telegramId: user.telegramId || null,
        telegramUsername: user.telegramUsername || null,
        phone: user.phone || null,
    };

    if (hasName) {
        const name = String(body.name || "").trim();
        if (!name) throw httpError(400, "Thiếu tên");
        user.name = name;
    }
    if (hasTelegramId || hasTelegramUsername || hasPhone) {
        const telegramId = normalizeTelegramId(hasTelegramId ? body.telegramId : user.telegramId);
        const telegramUsername = normalizeTelegramUsername(hasTelegramUsername ? body.telegramUsername : user.telegramUsername);
        const phone = normalizePhone(hasPhone ? body.phone : user.phone);
        if (!isValidTelegramId(telegramId)) throw httpError(400, "Telegram ID không hợp lệ");
        if (!isValidTelegramUsername(telegramUsername)) throw httpError(400, "Telegram username không hợp lệ");
        if (!isValidPhone(phone)) throw httpError(400, "Số điện thoại không hợp lệ");
        user.telegramId = telegramId || undefined;
        user.telegramUsername = telegramUsername || undefined;
        user.phone = phone || undefined;
    }
    if (hasPassword) {
        if (typeof body.currentPassword !== "string" || !body.currentPassword) throw httpError(400, "Thiếu mật khẩu hiện tại");
        if (typeof body.password !== "string" || body.password.length < 8) throw httpError(400, "Mật khẩu phải từ 8 ký tự");
        const matched = await verifyPassword(body.currentPassword, user.passwordHash);
        if (!matched) throw httpError(400, "Mật khẩu hiện tại không đúng");
        user.passwordHash = await hashPassword(body.password);
    }

    try {
        await user.save();
    } catch (error) {
        if (error?.code === 11000) throw httpError(409, "Telegram ID đã tồn tại");
        throw error;
    }

    const after = sessionUser(user);
    const changes = buildChanges(before, after, AUDITED_FIELDS);
    if (hasPassword) changes.password = { changed: true };
    if (Object.keys(changes).length) {
        await safeRecordAudit({
            action: "user.profile_updated",
            actor,
            targetType: "user",
            target: { id: actor.id, username: actor.username, email: actor.email },
            changes,
        });
    }
    return after;
}

module.exports = { updateSelfProfile };
