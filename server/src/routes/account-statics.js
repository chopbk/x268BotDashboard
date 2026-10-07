const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { PERMISSIONS } = require("../auth/access-control");
const { listAccountStatics } = require("../lib/account-statics");
const { sendError } = require("../lib/http");
const router = express.Router();
router.get("/", requireAuth, requirePermission(PERMISSIONS.STATISTICS_VIEW), async (req, res) => {
    try { res.json(await listAccountStatics(req.webUser, req.query)); }
    catch (error) { sendError(res, error, "GET /api/account-statics"); }
});
module.exports = router;
