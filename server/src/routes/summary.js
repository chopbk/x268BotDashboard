const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { PERMISSIONS, hasPermission } = require("../auth/access-control");
const { sendError } = require("../lib/http");
const { getSystemSummary, normalizeAudience } = require("../lib/system-summary");
const { getSummarySnapshot, forceSummarySnapshot } = require("../lib/summary-snapshots");
const { createRateLimit } = require("../middleware/rate-limit");

const router = express.Router();
const refreshLimit = createRateLimit({ windowMs: 15 * 60 * 1000, max: 6, prefix: "summary" });

function usesSystemSnapshot(actor) {
    return actor?.role === "admin" || actor?.role === "summary_viewer";
}

const SUMMARY_PERMISSIONS = [PERMISSIONS.SUMMARY_VIEW, PERMISSIONS.BOTS_VIEW, PERMISSIONS.STATISTICS_VIEW];

function requireSummaryAccess(req, res, next) {
    if (SUMMARY_PERMISSIONS.some((permission) => hasPermission(req.webUser, permission))) return next();
    return res.status(403).json({ error: "Không có quyền" });
}

router.use(requireAuth, requireSummaryAccess);

router.get("/", async (req, res) => {
    try {
        const audience = normalizeAudience(req.query.audience);
        if (audience === "system" && usesSystemSnapshot(req.webUser)) {
            res.json({ ...(await getSummarySnapshot(req.query.range)), audience });
            return;
        }
        res.json(await getSystemSummary(req.query.range, new Date(), req.webUser, audience));
    } catch (error) {
        sendError(res, error, "GET /api/summary");
    }
});

router.post("/refresh", refreshLimit, async (req, res) => {
    try {
        const audience = normalizeAudience(req.query.audience || req.body?.audience);
        const range = req.query.range || req.body?.range;
        if (audience === "system" && usesSystemSnapshot(req.webUser)) {
            res.json({ ...(await forceSummarySnapshot(range)), audience });
            return;
        }
        res.json(await getSystemSummary(range, new Date(), req.webUser, audience));
    } catch (error) {
        sendError(res, error, "POST /api/summary/refresh");
    }
});

module.exports = router;
