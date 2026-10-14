const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { PERMISSIONS, hasPermission } = require("../auth/access-control");
const { sendError } = require("../lib/http");
const peerProxyAdmin = require("../lib/peer-proxy-admin");

const router = express.Router();

function isAdminUser(user) {
    return user?.role === "admin";
}

function requireProcessRead(req, res, next) {
    if (
        isAdminUser(req.webUser) ||
        hasPermission(req.webUser, PERMISSIONS.PROCESSES_VIEW) ||
        hasPermission(req.webUser, PERMISSIONS.PROCESSES_EDIT) ||
        hasPermission(req.webUser, PERMISSIONS.PROCESSES_RESTART)
    ) {
        return next();
    }
    return res.status(403).json({ error: "Không có quyền xem peer proxy" });
}

function requireProcessEdit(req, res, next) {
    if (isAdminUser(req.webUser) || hasPermission(req.webUser, PERMISSIONS.PROCESSES_EDIT)) {
        return next();
    }
    return res.status(403).json({ error: "Không có quyền sửa peer proxy" });
}

function canRestart(user) {
    return isAdminUser(user) || hasPermission(user, PERMISSIONS.PROCESSES_RESTART);
}

/** Bật/tắt có restart thì cần processes.restart; không thì strip flag. */
function stripRestartIfUnauthorized(req) {
    if (req.body?.restart && !canRestart(req.webUser)) {
        req.body = { ...req.body, restart: false };
    }
}

router.use(requireAuth);

router.get("/", requireProcessRead, async (req, res) => {
    try {
        res.json(await peerProxyAdmin.getStatus());
    } catch (error) {
        sendError(res, error, "GET /api/admin/peer-proxy");
    }
});

router.put("/config", requireProcessEdit, async (req, res) => {
    try {
        res.json({ config: await peerProxyAdmin.saveConfig(req.body || {}, req.webUser) });
    } catch (error) {
        sendError(res, error, "PUT /api/admin/peer-proxy/config");
    }
});

router.post("/enable", requireProcessEdit, async (req, res) => {
    try {
        stripRestartIfUnauthorized(req);
        res.json(await peerProxyAdmin.applyEnable(req.body || {}, req.webUser));
    } catch (error) {
        sendError(res, error, "POST /api/admin/peer-proxy/enable");
    }
});

router.post("/disable", requireProcessEdit, async (req, res) => {
    try {
        stripRestartIfUnauthorized(req);
        res.json(await peerProxyAdmin.applyDisable(req.body || {}, req.webUser));
    } catch (error) {
        sendError(res, error, "POST /api/admin/peer-proxy/disable");
    }
});

module.exports = router;
