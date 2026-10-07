const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { PERMISSIONS } = require("../auth/access-control");
const { sendError } = require("../lib/http");
const { getSummarySnapshot } = require("../lib/summary-snapshots");

const router = express.Router();

router.get("/", requireAuth, requirePermission(PERMISSIONS.SUMMARY_VIEW), async (req, res) => {
    try {
        res.json(await getSummarySnapshot(req.query.range));
    } catch (error) {
        sendError(res, error, "GET /api/summary");
    }
});

module.exports = router;
