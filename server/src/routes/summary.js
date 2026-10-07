const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { PERMISSIONS } = require("../auth/access-control");
const { sendError } = require("../lib/http");
const { getCachedSystemSummary } = require("../lib/system-summary");

const router = express.Router();

router.get("/", requireAuth, requirePermission(PERMISSIONS.SUMMARY_VIEW), async (req, res) => {
    try {
        res.json(await getCachedSystemSummary(req.query.range));
    } catch (error) {
        sendError(res, error, "GET /api/summary");
    }
});

module.exports = router;
