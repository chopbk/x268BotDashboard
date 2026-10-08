const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { PERMISSIONS } = require("../auth/access-control");
const { sendError } = require("../lib/http");
const { loadLedger, refreshLedger } = require("../lib/account-ledger");
const { createRateLimit } = require("../middleware/rate-limit");

const router = express.Router();
const refreshLimit = createRateLimit({ windowMs: 15 * 60 * 1000, max: 6, prefix: "ledger" });

router.use(requireAuth, requirePermission(PERMISSIONS.STATISTICS_VIEW));

router.get("/", async (req, res) => {
    try {
        res.json(await loadLedger(req.webUser, req.query));
    } catch (error) {
        sendError(res, error, "GET /api/account-ledger");
    }
});

router.post("/:username/refresh", refreshLimit, async (req, res) => {
    try {
        const ledger = await refreshLedger(req.webUser, req.params.username, { days: req.body?.days });
        res.json(ledger);
    } catch (error) {
        sendError(res, error, "POST /api/account-ledger/:username/refresh");
    }
});

module.exports = router;
