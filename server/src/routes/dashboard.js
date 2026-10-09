const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { sendError } = require("../lib/http");
const { getDashboard } = require("../lib/dashboard");
const { askAttention } = require("../lib/dashboard-ai");

const router = express.Router();
const lastAsk = new Map();

router.get("/", requireAuth, async (req, res) => {
    try {
        res.json(await getDashboard(req.webUser));
    } catch (error) {
        sendError(res, error, "GET /api/dashboard");
    }
});

router.post("/attention", requireAuth, async (req, res) => {
    try {
        const id = String(req.webUser?.id || "");
        const now = Date.now();
        if (now - (lastAsk.get(id) || 0) < 15000) {
            res.status(429).json({ error: "Đợi một chút rồi gửi lại cho AI" });
            return;
        }
        lastAsk.set(id, now);
        res.json(await askAttention(req.webUser, req.body));
    } catch (error) {
        sendError(res, error, "POST /api/dashboard/attention");
    }
});

module.exports = router;
