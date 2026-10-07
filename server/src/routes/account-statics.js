const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { PERMISSIONS } = require("../auth/access-control");
const { listAccountStatics, getAccountStatic } = require("../lib/account-statics");
const { sendError } = require("../lib/http");
const router = express.Router();
router.get("/", requireAuth, requirePermission(PERMISSIONS.STATISTICS_VIEW), async (req, res) => {
    try { res.json(await listAccountStatics(req.webUser, req.query)); }
    catch (error) { sendError(res, error, "GET /api/account-statics"); }
});
router.get("/:id", requireAuth, requirePermission(PERMISSIONS.STATISTICS_VIEW), async (req, res) => {
    try { res.json(await getAccountStatic(req.webUser, req.params.id, req.query)); }
    catch (error) { sendError(res, error, "GET /api/account-statics/:id"); }
});
module.exports = router;
