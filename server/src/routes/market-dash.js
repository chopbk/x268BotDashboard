const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { PERMISSIONS, hasPermission } = require("../auth/access-control");
const { createRateLimit } = require("../middleware/rate-limit");
const {
    getDashOverview,
    getDashPulse,
    getDashHeatmap,
    getDashDerivatives,
    listDashSignals,
    getDashSymbolDetail,
} = require("../lib/market-dash/read-api");
const { requestDashRefresh } = require("../lib/market-dash/scheduler");

const router = express.Router();

const MARKET_READ_PERMISSIONS = [
    PERMISSIONS.MARKET_VIEW,
    PERMISSIONS.POSITIONS_VIEW,
    PERMISSIONS.ORDERS_VIEW,
    PERMISSIONS.STATISTICS_VIEW,
];

function requireMarketRead(req, res, next) {
    if (MARKET_READ_PERMISSIONS.some((permission) => hasPermission(req.webUser, permission))) {
        return next();
    }
    return res.status(403).json({ error: "Không có quyền" });
}

function requireMarketManage(req, res, next) {
    if (hasPermission(req.webUser, PERMISSIONS.MARKET_MANAGE)) return next();
    return res.status(403).json({ error: "Không có quyền quản lý collector" });
}

const refreshLimit = createRateLimit({
    prefix: "mdash-refresh",
    windowMs: 10 * 60 * 1000,
    max: 3,
    identify: (req) => req.webUser?.id || req.ip,
});

router.get("/overview", requireAuth, requireMarketRead, async (req, res) => {
    try {
        res.json(await getDashOverview());
    } catch (error) {
        console.error("[MARKET_DASH] overview", error.message || error);
        res.status(500).json({ error: "Không đọc được overview dashboard" });
    }
});

router.get("/pulse", requireAuth, requireMarketRead, async (req, res) => {
    try {
        res.json(await getDashPulse());
    } catch (error) {
        console.error("[MARKET_DASH] pulse", error.message || error);
        res.status(500).json({ error: "Không đọc được Market Pulse" });
    }
});

router.get("/heatmap", requireAuth, requireMarketRead, async (req, res) => {
    try {
        res.json(await getDashHeatmap(req.query || {}));
    } catch (error) {
        console.error("[MARKET_DASH] heatmap", error.message || error);
        res.status(500).json({ error: "Không đọc được heatmap" });
    }
});

router.get("/derivatives", requireAuth, requireMarketRead, async (req, res) => {
    try {
        res.json(await getDashDerivatives());
    } catch (error) {
        console.error("[MARKET_DASH] derivatives", error.message || error);
        res.status(500).json({ error: "Không đọc được derivatives" });
    }
});

router.get("/signals", requireAuth, requireMarketRead, async (req, res) => {
    try {
        res.json(await listDashSignals(req.query || {}));
    } catch (error) {
        console.error("[MARKET_DASH] signals", error.message || error);
        res.status(500).json({ error: "Không đọc được signals" });
    }
});

router.get("/symbols/:symbol", requireAuth, requireMarketRead, async (req, res) => {
    try {
        const body = await getDashSymbolDetail(req.params.symbol, req.query || {});
        if (body.error) return res.status(body.status || 400).json({ error: body.error });
        res.json(body);
    } catch (error) {
        console.error("[MARKET_DASH] symbol", error.message || error);
        res.status(500).json({ error: "Không đọc được chi tiết symbol" });
    }
});

router.post("/refresh", requireAuth, requireMarketManage, refreshLimit, async (req, res) => {
    try {
        const result = await requestDashRefresh();
        res.json({ ok: true, result });
    } catch (error) {
        console.error("[MARKET_DASH] refresh", error.message || error);
        res.status(500).json({ error: "Refresh thất bại" });
    }
});

module.exports = router;
