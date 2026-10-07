const WebUser = require("../models/web-user");
const config = require("../config");
const { verifyToken } = require("../auth/token");
const { PERMISSIONS, hasPermission, permissionsForUser, canAccessResource, plainScopes, scopeForPermission } = require("../auth/access-control");

function canAccessBot(user, botUsername, permission = PERMISSIONS.BOTS_VIEW) {
    return canAccessResource(user, permission, botUsername);
}

function requireResourcePermission(permission, getResource = (req) => req.params.username) {
    return function resourcePermissionMiddleware(req, res, next) {
        if (!canAccessResource(req.webUser, permission, getResource(req))) {
            return res.status(403).json({ error: "Không có quyền với tài nguyên này" });
        }
        next();
    };
}

function requireAllScope(permission) {
    return function allScopeMiddleware(req, res, next) {
        if (scopeForPermission(req.webUser, permission) !== "all") return res.status(403).json({ error: "Cần phạm vi tất cả" });
        next();
    };
}

function requirePermission(permission) {
    return function requirePermissionMiddleware(req, res, next) {
        if (!hasPermission(req.webUser, permission)) {
            return res.status(403).json({ error: "Không có quyền" });
        }
        next();
    };
}

async function requireAuth(req, res, next) {
    try {
        const token = req.cookies?.[config.cookieName];
        if (!token) return res.status(401).json({ error: "Chưa đăng nhập" });

        let payload;
        try {
            payload = verifyToken(token);
        } catch (error) {
            return res.status(401).json({ error: "Chưa đăng nhập" });
        }
        if (!payload?.sub) return res.status(401).json({ error: "Chưa đăng nhập" });

        const user = await WebUser.findById(payload.sub).select("-passwordHash").lean();
        if (!user || user.disabled) {
            return res.status(401).json({ error: "Chưa đăng nhập" });
        }

        req.webUser = {
            id: String(user._id),
            email: user.email,
            username: user.username || null,
            name: user.name,
            role: user.role,
            customPermissions: user.customPermissions,
            permissionScopes: plainScopes(user.permissionScopes),
            permissions: permissionsForUser(user),
            botUsernames: user.botUsernames || [],
            disabled: !!user.disabled,
        };
        next();
    } catch (error) {
        console.error("[requireAuth]", error);
        res.status(500).json({ error: "Internal error" });
    }
}

module.exports = { requireAuth, requirePermission, requireResourcePermission, requireAllScope, canAccessBot };
