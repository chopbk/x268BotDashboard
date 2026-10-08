const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { sendError } = require("../lib/http");
const { getDashboard } = require("../lib/dashboard");

const router = express.Router();

router.get("/", requireAuth, async (req, res) => {
    try {
        res.json(await getDashboard(req.webUser));
    } catch (error) {
        sendError(res, error, "GET /api/dashboard");
    }
});

module.exports = router;
