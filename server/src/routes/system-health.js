const express = require("express");
const { requireAuth, requirePermission, requireAllScope } = require("../middleware/auth");
const { PERMISSIONS, hasPermission } = require("../auth/access-control");
const { sendError } = require("../lib/http");
const {
    loadSystemHealth,
    deleteStaleHeartbeats,
    deleteHeartbeatByKey,
} = require("../lib/system-health");

const router = express.Router();

function isAdminUser(user) {
    return user?.role === "admin";
}

function requireProcessEdit(req, res, next) {
    if (isAdminUser(req.webUser) || hasPermission(req.webUser, PERMISSIONS.PROCESSES_EDIT)) {
        return next();
    }
    return res.status(403).json({ error: "Không có quyền xóa heartbeat" });
}

router.get("/", requireAuth, requirePermission(PERMISSIONS.LOGS_VIEW), requireAllScope(PERMISSIONS.LOGS_VIEW), async (req, res) => {
    try {
        res.json(await loadSystemHealth());
    } catch (error) {
        sendError(res, error, "GET /api/system-health");
    }
});

router.delete("/heartbeats/stale", requireAuth, requireProcessEdit, async (req, res) => {
    try {
        res.json(await deleteStaleHeartbeats());
    } catch (error) {
        sendError(res, error, "DELETE /api/system-health/heartbeats/stale");
    }
});

router.delete("/heartbeats/:key", requireAuth, requireProcessEdit, async (req, res) => {
    try {
        res.json(await deleteHeartbeatByKey(decodeURIComponent(req.params.key || "")));
    } catch (error) {
        sendError(res, error, "DELETE /api/system-health/heartbeats/:key");
    }
});

module.exports = router;
