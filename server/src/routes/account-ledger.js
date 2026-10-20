const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { PERMISSIONS } = require("../auth/access-control");
const { sendError } = require("../lib/http");
const { loadLedger, loadAssignedIncome, loadCombinedLedger, refreshLedger, refreshCombinedLedgers } = require("../lib/account-ledger");
const { createRateLimit } = require("../middleware/rate-limit");

const router = express.Router();
const refreshLimit = createRateLimit({
    windowMs: 10 * 60 * 1000,
    max: 4,
    prefix: "ledger-refresh",
    identify: (req) => String(req.webUser?.id || req.webUser?._id || req.webUser?.username || ""),
});

router.use(requireAuth, requirePermission(PERMISSIONS.STATISTICS_VIEW));

router.get("/", async (req, res) => {
    try {
        const scope = String(req.query.scope || "").trim();
        const view = String(req.query.view || "").trim();
        const payload = scope === "all" || scope === "mine" || scope === "assigned"
            ? await loadAssignedIncome(req.webUser, scope)
            : view === "all"
                ? await loadCombinedLedger(req.webUser, req.query)
                : await loadLedger(req.webUser, req.query);
        res.json(payload);
    } catch (error) {
        sendError(res, error, "GET /api/account-ledger");
    }
});

router.post("/refresh-all", refreshLimit, async (req, res) => {
    try {
        const ledger = await refreshCombinedLedgers(req.webUser, {
            days: req.body?.days || req.query.days,
            others: req.body?.others ?? req.query.others,
            inactive: req.body?.inactive ?? req.query.inactive,
        });
        res.json(ledger);
    } catch (error) {
        sendError(res, error, "POST /api/account-ledger/refresh-all");
    }
});

router.post("/:username/refresh", refreshLimit, async (req, res) => {
    try {
        if (String(req.params.username || "") === "__all__") {
            const ledger = await refreshCombinedLedgers(req.webUser, {
                days: req.body?.days || req.query.days,
                others: req.body?.others ?? req.query.others,
                inactive: req.body?.inactive ?? req.query.inactive,
            });
            res.json(ledger);
            return;
        }
        const ledger = await refreshLedger(req.webUser, req.params.username, { days: req.body?.days });
        res.json(ledger);
    } catch (error) {
        sendError(res, error, "POST /api/account-ledger/:username/refresh");
    }
});

module.exports = router;
