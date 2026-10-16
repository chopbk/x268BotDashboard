const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { PERMISSIONS, hasPermission } = require("../auth/access-control");
const { createRateLimit } = require("../middleware/rate-limit");
const {
    getStatusPayload,
    listSymbolsQuery,
    getSymbolDetail,
    getSymbolScores,
    listEvents,
    normalizeSymbol,
} = require("../lib/market/read-api");
const { requestRefresh } = require("../lib/market/scheduler");

const router = express.Router();

/** Đọc: market.view hoặc cùng cửa Terminal/Smart Money. */
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
    return res.status(403).json({ error: "Không có quyền quản lý collector thị trường" });
}

const refreshLimit = createRateLimit({
    prefix: "market-refresh",
    windowMs: 10 * 60 * 1000,
    max: 3,
    identify: (req) => req.webUser?.id || req.ip,
});

router.get("/overview", requireAuth, requireMarketRead, async (req, res) => {
    try {
        res.json(await getStatusPayload());
    } catch (error) {
        console.error("[market:overview]", error.message || error);
        res.status(500).json({ error: "Không đọc được tổng quan thị trường" });
    }
});

router.get("/symbols", requireAuth, requireMarketRead, async (req, res) => {
    try {
        res.json(await listSymbolsQuery(req.query || {}));
    } catch (error) {
        console.error("[market:symbols]", error.message || error);
        res.status(500).json({ error: "Không đọc được danh sách symbol" });
    }
});

router.get("/symbols/:symbol", requireAuth, requireMarketRead, async (req, res) => {
    try {
        const body = await getSymbolDetail(req.params.symbol, req.query || {});
        if (body.error) return res.status(body.status || 400).json({ error: body.error });
        res.json(body);
    } catch (error) {
        console.error("[market:symbol]", error.message || error);
        res.status(500).json({ error: "Không đọc được chi tiết symbol" });
    }
});

router.get("/symbols/:symbol/scores", requireAuth, requireMarketRead, async (req, res) => {
    try {
        const body = await getSymbolScores(req.params.symbol, req.query || {});
        if (body.error) return res.status(body.status || 400).json({ error: body.error });
        res.json(body);
    } catch (error) {
        console.error("[market:scores]", error.message || error);
        res.status(500).json({ error: "Không đọc được lịch sử điểm" });
    }
});

router.get("/events", requireAuth, requireMarketRead, async (req, res) => {
    try {
        const symbol = req.query.symbol ? normalizeSymbol(req.query.symbol) : null;
        if (req.query.symbol && !symbol) return res.status(400).json({ error: "symbol_invalid" });
        const rows = await listEvents({
            symbol: symbol || undefined,
            limit: req.query.limit,
            from: req.query.from,
        });
        res.json({ count: rows.length, rows });
    } catch (error) {
        console.error("[market:events]", error.message || error);
        res.status(500).json({ error: "Không đọc được sự kiện" });
    }
});

router.post("/refresh", requireAuth, requireMarketManage, refreshLimit, async (req, res) => {
    try {
        const result = await requestRefresh();
        res.json({ ok: true, result });
    } catch (error) {
        console.error("[market:refresh]", error.message || error);
        res.status(500).json({ error: "Không refresh được collector" });
    }
});

module.exports = router;
