const express = require("express");
const mongoose = require("mongoose");
const WebUser = require("../models/web-user");
const { requireAuth, requirePermission } = require("../middleware/auth");
const {
    PERMISSIONS,
    PERMISSION_LABELS,
    ROLE_PERMISSIONS,
    isPermission,
} = require("../auth/access-control");
const { hashPassword } = require("../auth/password");
const {
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
} = require("../lib/validate");
const { publicUser } = require("../lib/public-user");
const { buildChanges, safeRecordAudit } = require("../lib/audit");
const { unknownBotUsernames } = require("../lib/bots");
const { httpError, sendError } = require("../lib/http");

const router = express.Router();
const AUDITED_USER_FIELDS = [
    "name",
    "username",
    "email",
    "telegramId",
    "telegramUsername",
    "phone",
    "role",
    "customPermissions",
    "botUsernames",
    "disabled",
];

router.use(requireAuth, requirePermission(PERMISSIONS.USERS_MANAGE));

function isObjectId(id) {
    return mongoose.Types.ObjectId.isValid(id) && String(new mongoose.Types.ObjectId(id)) === id;
}

async function assertBotsExist(names) {
    const missing = await unknownBotUsernames(names);
    if (missing.length) {
        throw httpError(400, "Bot username không tồn tại", { missing });
    }
}

function parseCustomPermissions(value) {
    if (value === null || value === undefined) return { permissions: undefined };
    if (!Array.isArray(value)) return { error: "customPermissions phải là mảng hoặc null" };
    const permissions = [...new Set(value)];
    if (permissions.some((permission) => typeof permission !== "string" || !isPermission(permission))) {
        return { error: "Có permission không hợp lệ" };
    }
    return { permissions };
}

function parseProfile(body) {
    const telegramId = normalizeTelegramId(body?.telegramId);
    const telegramUsername = normalizeTelegramUsername(body?.telegramUsername);
    const phone = normalizePhone(body?.phone);
    if (!isValidTelegramId(telegramId)) return { error: "Telegram ID không hợp lệ" };
    if (!isValidTelegramUsername(telegramUsername)) {
        return { error: "Telegram username không hợp lệ" };
    }
    if (!isValidPhone(phone)) return { error: "Số điện thoại không hợp lệ" };
    return {
        profile: {
            telegramId: telegramId || undefined,
            telegramUsername: telegramUsername || undefined,
            phone: phone || undefined,
        },
    };
}

async function ensureAdminRemains(target, next) {
    const nextRole = next.role ?? target.role;
    const nextDisabled = next.disabled ?? target.disabled;
    const staysActiveAdmin = nextRole === "admin" && nextDisabled === false;
    const isActiveAdmin = target.role === "admin" && !target.disabled;
    if (!isActiveAdmin || staysActiveAdmin) return;

    const others = await WebUser.countDocuments({
        role: "admin",
        disabled: false,
        _id: { $ne: target._id },
    });
    if (others === 0) {
        throw httpError(400, "Phải còn ít nhất một admin đang hoạt động");
    }
}

router.get("/", async (req, res) => {
    try {
        const users = await WebUser.find().select("-passwordHash").sort({ createdAt: 1 }).lean();
        res.json({ users: users.map(publicUser) });
    } catch (error) {
        sendError(res, error, "GET /api/admin/users");
    }
});

router.get("/access-control", (req, res) => {
    res.json({
        permissions: Object.values(PERMISSIONS).map((key) => ({ key, label: PERMISSION_LABELS[key] })),
        rolePermissions: ROLE_PERMISSIONS,
    });
});

router.post("/", async (req, res) => {
    try {
        const email = normalizeEmail(req.body?.email);
        const username = normalizeUsername(req.body?.username);
        const name = String(req.body?.name || "").trim();
        const password = req.body?.password;
        const role = req.body?.role || "viewer";
        const parsedBots = parseBotUsernames(req.body?.botUsernames || []);
        const parsedProfile = parseProfile(req.body);
        const parsedPermissions = parseCustomPermissions(req.body?.customPermissions);

        if (!isValidEmail(email)) throw httpError(400, "Email không hợp lệ");
        if (!isValidUsername(username)) throw httpError(400, "Username không hợp lệ");
        if (!name) throw httpError(400, "Thiếu tên");
        if (typeof password !== "string" || password.length < 8) {
            throw httpError(400, "Mật khẩu phải từ 8 ký tự");
        }
        if (!isRole(role)) throw httpError(400, "Role không hợp lệ");
        if (parsedBots.error) throw httpError(400, parsedBots.error);
        if (parsedProfile.error) throw httpError(400, parsedProfile.error);
        if (parsedPermissions.error) throw httpError(400, parsedPermissions.error);

        await assertBotsExist(parsedBots.names);
        const passwordHash = await hashPassword(password);
        const created = await WebUser.create({
            email,
            username,
            passwordHash,
            name,
            role,
            ...parsedProfile.profile,
            customPermissions:
                role === "admin" || role === "pending" ? undefined : parsedPermissions.permissions,
            botUsernames: parsedBots.names,
            disabled: false,
        });
        const createdPublic = publicUser(created);
        await safeRecordAudit({
            action: "user.created",
            actor: req.webUser,
            targetType: "user",
            target: created,
            changes: buildChanges({}, createdPublic, AUDITED_USER_FIELDS),
        });
        res.status(201).json({ user: createdPublic });
    } catch (error) {
        if (error?.code === 11000) {
            return res.status(409).json({
                error: "Email, username hoặc Telegram ID đã tồn tại",
            });
        }
        sendError(res, error, "POST /api/admin/users");
    }
});

router.patch("/:id", async (req, res) => {
    try {
        const { id } = req.params;
        if (!isObjectId(id)) throw httpError(400, "Id không hợp lệ");

        const target = await WebUser.findById(id);
        if (!target) throw httpError(404, "Không tìm thấy user");
        const before = publicUser(target);

        const body = req.body || {};
        const next = {};
        const hasName = Object.prototype.hasOwnProperty.call(body, "name");
        const hasUsername = Object.prototype.hasOwnProperty.call(body, "username");
        const hasRole = Object.prototype.hasOwnProperty.call(body, "role");
        const hasBots = Object.prototype.hasOwnProperty.call(body, "botUsernames");
        const hasDisabled = Object.prototype.hasOwnProperty.call(body, "disabled");
        const hasPassword = Object.prototype.hasOwnProperty.call(body, "password");
        const hasTelegramId = Object.prototype.hasOwnProperty.call(body, "telegramId");
        const hasTelegramUsername = Object.prototype.hasOwnProperty.call(body, "telegramUsername");
        const hasPhone = Object.prototype.hasOwnProperty.call(body, "phone");
        const hasPermissions = Object.prototype.hasOwnProperty.call(body, "customPermissions");
        if (
            !hasName &&
            !hasUsername &&
            !hasRole &&
            !hasBots &&
            !hasDisabled &&
            !hasPassword &&
            !hasTelegramId &&
            !hasTelegramUsername &&
            !hasPhone &&
            !hasPermissions
        ) {
            throw httpError(400, "Không có dữ liệu để cập nhật");
        }

        if (hasName) {
            const name = String(body.name || "").trim();
            if (!name) throw httpError(400, "Thiếu tên");
            next.name = name;
        }
        if (hasUsername) {
            const username = normalizeUsername(body.username);
            if (!isValidUsername(username)) throw httpError(400, "Username không hợp lệ");
            next.username = username;
        }
        if (hasTelegramId || hasTelegramUsername || hasPhone) {
            const parsedProfile = parseProfile({
                telegramId: hasTelegramId ? body.telegramId : target.telegramId,
                telegramUsername: hasTelegramUsername
                    ? body.telegramUsername
                    : target.telegramUsername,
                phone: hasPhone ? body.phone : target.phone,
            });
            if (parsedProfile.error) throw httpError(400, parsedProfile.error);
            Object.assign(next, parsedProfile.profile);
            if (hasTelegramId && !parsedProfile.profile.telegramId) next.telegramId = undefined;
            if (hasTelegramUsername && !parsedProfile.profile.telegramUsername) {
                next.telegramUsername = undefined;
            }
            if (hasPhone && !parsedProfile.profile.phone) next.phone = undefined;
        }
        if (hasRole) {
            if (!isRole(body.role)) throw httpError(400, "Role không hợp lệ");
            next.role = body.role;
        }
        if (hasPermissions) {
            const parsedPermissions = parseCustomPermissions(body.customPermissions);
            if (parsedPermissions.error) throw httpError(400, parsedPermissions.error);
            next.customPermissions = parsedPermissions.permissions;
        } else if (hasRole && body.role !== target.role) {
            next.customPermissions = undefined;
        }
        const effectiveRole = next.role ?? target.role;
        if (effectiveRole === "admin" || effectiveRole === "pending") {
            next.customPermissions = undefined;
        }
        if (hasDisabled) {
            if (typeof body.disabled !== "boolean") throw httpError(400, "disabled phải là boolean");
            next.disabled = body.disabled;
        }
        if (hasBots) {
            const parsedBots = parseBotUsernames(body.botUsernames);
            if (parsedBots.error) throw httpError(400, parsedBots.error);
            await assertBotsExist(parsedBots.names);
            next.botUsernames = parsedBots.names;
        }
        if (hasPassword && body.password) {
            if (typeof body.password !== "string" || body.password.length < 8) {
                throw httpError(400, "Mật khẩu phải từ 8 ký tự");
            }
            next.passwordHash = await hashPassword(body.password);
        }

        await ensureAdminRemains(target, next);
        Object.assign(target, next);
        await target.save();
        const after = publicUser(target);
        const changes = buildChanges(before, after, AUDITED_USER_FIELDS);
        if (hasPassword && body.password) changes.password = { changed: true };
        if (Object.keys(changes).length > 0) {
            await safeRecordAudit({
                action: "user.updated",
                actor: req.webUser,
                targetType: "user",
                target,
                changes,
            });
        }
        res.json({ user: after });
    } catch (error) {
        if (error?.code === 11000) {
            return res.status(409).json({
                error: "Email, username hoặc Telegram ID đã tồn tại",
            });
        }
        sendError(res, error, "PATCH /api/admin/users/:id");
    }
});

module.exports = router;
