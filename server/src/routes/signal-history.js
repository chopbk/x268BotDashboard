const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { PERMISSIONS } = require("../auth/access-control");
const { listSignalHistory } = require("../lib/signal-history");
const { sendError } = require("../lib/http");

const router = express.Router();

router.get("/", requireAuth, requirePermission(PERMISSIONS.SIGNALS_HISTORY), async (req, res) => {
    try {
        res.json(await listSignalHistory(req.webUser, req.query));
    } catch (error) {
        sendError(res, error, "GET /api/signal-history");
    }
});

module.exports = router;
