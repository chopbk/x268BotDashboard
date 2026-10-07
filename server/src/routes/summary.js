const express = require("express");
const UserAccount = require("../models/user-account");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { PERMISSIONS } = require("../auth/access-control");
const { sendError } = require("../lib/http");

const router = express.Router();

router.get("/", requireAuth, requirePermission(PERMISSIONS.SUMMARY_VIEW), async (req, res) => {
    try {
        const rows = await UserAccount.find().select("accounts").lean();
        res.json({
            botCount: rows.length,
            configCount: rows.reduce((total, row) => total + (row.accounts || []).length, 0),
        });
    } catch (error) {
        sendError(res, error, "GET /api/summary");
    }
});

module.exports = router;
