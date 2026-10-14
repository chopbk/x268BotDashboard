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
        hasPermission(req.webUser, PERMISSIONS.PROCESSES_RESTART) ||
        hasPermission(req.webUser, PERMISSIONS.LOGS_VIEW)
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

router.use(requireAuth);

router.get("/", requireProcessRead, async (req, res) => {
    try {
        res.json(await peerProxyAdmin.getStatus());
    } catch (error) {
        sendError(res, error, "GET /api/admin/peer-proxy");
    }
});

router.post("/probe", requireProcessRead, async (req, res) => {
    try {
        res.json(await peerProxyAdmin.runProbe(req.webUser));
    } catch (error) {
        sendError(res, error, "POST /api/admin/peer-proxy/probe");
    }
});

/** Sửa pool (dùng để probe / hydrate web) — không gắn env process bot. */
router.put("/config", requireProcessEdit, async (req, res) => {
    try {
        res.json({ config: await peerProxyAdmin.saveConfig(req.body || {}, req.webUser) });
    } catch (error) {
        sendError(res, error, "PUT /api/admin/peer-proxy/config");
    }
});

module.exports = router;
