const express = require("express");
const { requireAuth, requirePermission, requireAllScope } = require("../middleware/auth");
const { PERMISSIONS } = require("../auth/access-control");
const { sendError } = require("../lib/http");
const { loadSystemHealth } = require("../lib/system-health");

const router = express.Router();

router.get("/", requireAuth, requirePermission(PERMISSIONS.LOGS_VIEW), requireAllScope(PERMISSIONS.LOGS_VIEW), async (req, res) => {
    try {
        res.json(await loadSystemHealth());
    } catch (error) {
        sendError(res, error, "GET /api/system-health");
    }
});

module.exports = router;
