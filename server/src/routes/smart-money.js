const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { PERMISSIONS, hasPermission } = require("../auth/access-control");
const { createRateLimit } = require("../middleware/rate-limit");
const {
    getStatusPayload,
    listSymbolsQuery,
    getSymbolDetail,
    getSymbolHistory,
    getCandidates,
    listEvents,
    buildMoneyFlow,
    getUserWatchlist,
    setUserWatchlist,
    normalizeSymbol,
} = require("../lib/smart-money/read-api");
const { requestRefresh } = require("../lib/smart-money/scheduler");

const router = express.Router();

/** Cùng cửa vào Terminal: ai xem Terminal được thì đọc Smart Money được. */
const SMART_MONEY_READ_PERMISSIONS = [
    PERMISSIONS.SMART_MONEY_VIEW,
    PERMISSIONS.POSITIONS_VIEW,
    PERMISSIONS.ORDERS_VIEW,
    PERMISSIONS.STATISTICS_VIEW,
];

function requireSmartMoneyRead(req, res, next) {
    if (SMART_MONEY_READ_PERMISSIONS.some((permission) => hasPermission(req.webUser, permission))) {
        return next();
    }
    return res.status(403).json({ error: "Không có quyền" });
}

const refreshLimit = createRateLimit({
    prefix: "smart-money-refresh",
    windowMs: 10 * 60 * 1000,
    max: 4,
    identify: (req) => req.webUser?.id || req.ip,
});

router.get("/status", requireAuth, requireSmartMoneyRead, async (req, res) => {
    try {
        res.json(await getStatusPayload());
    } catch (error) {
        console.error("[smartMoney:status]", error.message || error);
        res.status(500).json({ error: "Không đọc được trạng thái collector" });
    }
});

router.get("/symbols", requireAuth, requireSmartMoneyRead, async (req, res) => {
    try {
        res.json(await listSymbolsQuery(req.query || {}));
    } catch (error) {
        console.error("[smartMoney:symbols]", error.message || error);
        res.status(500).json({ error: "Không đọc được danh sách symbol" });
    }
});

router.get("/symbols/:symbol", requireAuth, requireSmartMoneyRead, async (req, res) => {
    try {
        const body = await getSymbolDetail(req.params.symbol);
        if (body.error) return res.status(body.status || 400).json({ error: body.error });
        res.json(body);
    } catch (error) {
        console.error("[smartMoney:symbol]", error.message || error);
        res.status(500).json({ error: "Không đọc được chi tiết symbol" });
    }
});

router.get("/symbols/:symbol/history", requireAuth, requireSmartMoneyRead, async (req, res) => {
    try {
        const body = await getSymbolHistory(req.params.symbol, req.query || {});
        if (body.error) return res.status(body.status || 400).json({ error: body.error });
        res.json(body);
    } catch (error) {
        console.error("[smartMoney:history]", error.message || error);
        res.status(500).json({ error: "Không đọc được lịch sử" });
    }
});

router.get("/events", requireAuth, requireSmartMoneyRead, async (req, res) => {
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
        console.error("[smartMoney:events]", error.message || error);
        res.status(500).json({ error: "Không đọc được sự kiện" });
    }
});

router.get("/candidates", requireAuth, requireSmartMoneyRead, async (req, res) => {
    try {
        const doc = await getCandidates();
        const bucket = req.query.bucket ? String(req.query.bucket) : null;
        let items = doc.items || [];
        if (bucket) items = items.filter((i) => i.bucket === bucket);
        res.json({
            version: doc.version,
            generatedAt: doc.generatedAt,
            expiresAt: doc.expiresAt,
            count: items.length,
            items,
            note: "Ứng viên cần xem xét — điểm không phải xác suất thắng.",
        });
    } catch (error) {
        console.error("[smartMoney:candidates]", error.message || error);
        res.status(500).json({ error: "Không đọc được ứng viên" });
    }
});

router.get("/watchlist", requireAuth, requireSmartMoneyRead, async (req, res) => {
    try {
        res.json(await getUserWatchlist(req.webUser.id));
    } catch (error) {
        console.error("[smartMoney:watchlist:get]", error.message || error);
        res.status(500).json({ error: "Không đọc được watchlist" });
    }
});

router.put("/watchlist", requireAuth, requireSmartMoneyRead, async (req, res) => {
    try {
        const symbols = Array.isArray(req.body?.symbols) ? req.body.symbols : [];
        res.json(await setUserWatchlist(req.webUser.id, symbols));
    } catch (error) {
        console.error("[smartMoney:watchlist:put]", error.message || error);
        res.status(500).json({ error: "Không lưu được watchlist" });
    }
});

router.get("/money-flow/:symbol", requireAuth, requireSmartMoneyRead, async (req, res) => {
    try {
        const symbol = normalizeSymbol(req.params.symbol);
        if (!symbol) return res.status(400).json({ error: "symbol_invalid" });
        let positionContext = null;
        if (req.query.side || req.query.notional) {
            // Chỉ dùng context do client gửi cho vị thế đã được scope ở Terminal;
            // không suy vị thế người khác từ đây.
            positionContext = {
                side: req.query.side ? String(req.query.side).toUpperCase() : null,
                notional: req.query.notional != null ? Number(req.query.notional) : null,
            };
        }
        res.json(await buildMoneyFlow(symbol, positionContext));
    } catch (error) {
        console.error("[smartMoney:moneyFlow]", error.message || error);
        res.status(500).json({ error: "Không đọc được dòng tiền" });
    }
});

router.post(
    "/refresh",
    requireAuth,
    requirePermission(PERMISSIONS.SMART_MONEY_MANAGE),
    refreshLimit,
    async (req, res) => {
        try {
            const symbols = Array.isArray(req.body?.symbols) ? req.body.symbols : [];
            const result = await requestRefresh({ symbols, actorId: req.webUser.id });
            res.json({
                ok: true,
                ...result,
                note: "Refresh chỉ enqueue trong TTL/cooldown — không bypass limiter.",
            });
        } catch (error) {
            console.error("[smartMoney:refresh]", error.message || error);
            res.status(500).json({ error: "Không enqueue được refresh" });
        }
    }
);

module.exports = router;
