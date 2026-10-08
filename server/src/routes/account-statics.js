const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { PERMISSIONS } = require("../auth/access-control");
const { listAccountStatics, listAssignedStatics, getAccountStatic } = require("../lib/account-statics");
const { sendError } = require("../lib/http");
const router = express.Router();
router.get("/", requireAuth, requirePermission(PERMISSIONS.STATISTICS_VIEW), async (req, res) => {
    try {
        const scope = String(req.query.scope || "").trim();
        const username = String(req.query.username || "").trim();
        res.json((scope === "assigned" || scope === "mine") && !username
            ? await listAssignedStatics(req.webUser, req.query)
            : await listAccountStatics(req.webUser, req.query));
    }
    catch (error) { sendError(res, error, "GET /api/account-statics"); }
});
router.get("/:id", requireAuth, requirePermission(PERMISSIONS.STATISTICS_VIEW), async (req, res) => {
    try { res.json(await getAccountStatic(req.webUser, req.params.id, req.query)); }
    catch (error) { sendError(res, error, "GET /api/account-statics/:id"); }
});
module.exports = router;
