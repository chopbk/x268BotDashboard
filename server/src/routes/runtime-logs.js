const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { PERMISSIONS } = require("../auth/access-control");
const { sendError } = require("../lib/http");
const { listRuntimeLogs } = require("../lib/runtime-logs");

const router = express.Router();

router.use(requireAuth, requirePermission(PERMISSIONS.LOGS_VIEW));

router.get("/", async (req, res) => {
    try {
        res.json(await listRuntimeLogs(req.webUser, req.query));
    } catch (error) {
        sendError(res, error, "GET /api/runtime-logs");
    }
});

module.exports = router;
