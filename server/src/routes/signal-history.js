const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { PERMISSIONS } = require("../auth/access-control");
const { listSignalHistory, listRecentSignalsBySymbols } = require("../lib/signal-history");
const { sendError } = require("../lib/http");

const router = express.Router();

router.get("/", requireAuth, requirePermission(PERMISSIONS.SIGNALS_HISTORY), async (req, res) => {
    try {
        res.json(await listSignalHistory(req.webUser, req.query));
    } catch (error) {
        sendError(res, error, "GET /api/signal-history");
    }
});

/** Cột Thị trường: signal gần đây theo danh sách symbol (top 50). */
router.get("/recent-by-symbol", requireAuth, requirePermission(PERMISSIONS.SIGNALS_HISTORY), async (req, res) => {
    try {
        res.json(await listRecentSignalsBySymbols(req.webUser, req.query));
    } catch (error) {
        sendError(res, error, "GET /api/signal-history/recent-by-symbol");
    }
});

module.exports = router;
