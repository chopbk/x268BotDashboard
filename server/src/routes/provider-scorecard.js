const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { PERMISSIONS, hasPermission } = require("../auth/access-control");
const { listProviderScorecard } = require("../lib/provider-scorecard");
const { sendError } = require("../lib/http");

const router = express.Router();

function requireScorecard(req, res, next) {
    if (!hasPermission(req.webUser, PERMISSIONS.STATISTICS_VIEW) && !hasPermission(req.webUser, PERMISSIONS.SIGNALS_HISTORY)) {
        return res.status(403).json({ error: "Không có quyền" });
    }
    next();
}

router.get("/", requireAuth, requireScorecard, async (req, res) => {
    try {
        res.json(await listProviderScorecard(req.webUser, req.query));
    } catch (error) {
        sendError(res, error, "GET /api/provider-scorecard");
    }
});

module.exports = router;
