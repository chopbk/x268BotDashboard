const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { PERMISSIONS } = require("../auth/access-control");
const { listAccountStatics, listAssignedStatics, getAccountStatic } = require("../lib/account-statics");
const { suggestStaticFilters } = require("../lib/account-statics-ai");
const { sendError } = require("../lib/http");

const router = express.Router();

router.get("/", requireAuth, requirePermission(PERMISSIONS.STATISTICS_VIEW), async (req, res) => {
    try {
        const scope = String(req.query.scope || "").trim();
        const username = String(req.query.username || "").trim();
        res.json((scope === "all" || scope === "mine" || scope === "assigned") && !username
            ? await listAssignedStatics(req.webUser, req.query)
            : await listAccountStatics(req.webUser, req.query));
    }
    catch (error) { sendError(res, error, "GET /api/account-statics"); }
});

router.post("/ai-suggest", requireAuth, requirePermission(PERMISSIONS.STATISTICS_VIEW), async (req, res) => {
    try { res.json(await suggestStaticFilters(req.webUser, req.body || {})); }
    catch (error) { sendError(res, error, "POST /api/account-statics/ai-suggest"); }
});

router.get("/:id", requireAuth, requirePermission(PERMISSIONS.STATISTICS_VIEW), async (req, res) => {
    try { res.json(await getAccountStatic(req.webUser, req.params.id, req.query)); }
    catch (error) { sendError(res, error, "GET /api/account-statics/:id"); }
});

module.exports = router;
