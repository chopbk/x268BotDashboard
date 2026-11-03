const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { PERMISSIONS, hasPermission } = require("../auth/access-control");
const { config } = require("../lib/market-economy/config");
const {
    getEconomyContext,
    getEconomySeries,
    getEconomyCalendar,
    getEconomyEvent,
    getEconomyNews,
} = require("../lib/market-economy/read-api");

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

function requireEconomyEnabled(req, res, next) {
    if (!config.enabled) {
        return res.status(503).json({
            error: "Market Economy chưa bật",
            flag: "MARKET_ECONOMY_ENABLED",
        });
    }
    return next();
}

router.get("/status", requireAuth, requireMarketRead, (_req, res) => {
    res.json({
        enabled: config.enabled,
        newsEnabled: config.newsEnabled,
        reactionEnabled: config.reactionEnabled,
        remindersEnabled: config.remindersEnabled,
        actualMode: "schedule_only",
        actualModeLabelVi:
            "Chế độ lịch: chỉ lịch + Forecast/Previous — chưa có Actual chính thức đã xác minh",
        defaultTz: config.defaultTz,
        locale: "vi",
    });
});

router.get("/context", requireAuth, requireMarketRead, requireEconomyEnabled, async (req, res) => {
    try {
        const body = await getEconomyContext(req.query || {});
        if (body.status) return res.status(body.status).json({ error: body.error });
        res.json(body);
    } catch (error) {
        console.error("[MARKET_ECONOMY] context", error.message || error);
        res.status(503).json({ error: "Không đọc được economy context" });
    }
});

router.get("/series/:metricId", requireAuth, requireMarketRead, requireEconomyEnabled, async (req, res) => {
    try {
        const body = await getEconomySeries(req.params.metricId, req.query || {});
        if (body.status) return res.status(body.status).json({ error: body.error });
        res.json(body);
    } catch (error) {
        console.error("[MARKET_ECONOMY] series", error.message || error);
        res.status(503).json({ error: "Không đọc được series" });
    }
});

router.get("/calendar", requireAuth, requireMarketRead, requireEconomyEnabled, async (req, res) => {
    try {
        const body = await getEconomyCalendar(req.query || {});
        if (body.status) return res.status(body.status).json({ error: body.error });
        res.json(body);
    } catch (error) {
        console.error("[MARKET_ECONOMY] calendar", error.message || error);
        res.status(503).json({ error: "Không đọc được lịch kinh tế" });
    }
});

router.get("/events/:eventId", requireAuth, requireMarketRead, requireEconomyEnabled, async (req, res) => {
    try {
        const body = await getEconomyEvent(req.params.eventId, req.query || {});
        if (body.status) return res.status(body.status).json({ error: body.error });
        res.json(body);
    } catch (error) {
        console.error("[MARKET_ECONOMY] event", error.message || error);
        res.status(503).json({ error: "Không đọc được sự kiện" });
    }
});

router.get("/news", requireAuth, requireMarketRead, requireEconomyEnabled, async (req, res) => {
    try {
        const body = await getEconomyNews(req.query || {});
        if (body.status) return res.status(body.status).json({ error: body.error, flag: body.flag });
        res.json(body);
    } catch (error) {
        console.error("[MARKET_ECONOMY] news", error.message || error);
        res.status(503).json({ error: "Không đọc được tin tức" });
    }
});

module.exports = router;
