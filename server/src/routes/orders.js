/**
 * Orders API routes - Phase A: Read-only
 * Spec: trading-terminal-spec.md mục 12.2
 */
const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { PERMISSIONS } = require("../auth/access-control");
const { sendError } = require("../lib/http");
const { loadOpenOrders, loadOrderHistory, getOrderDetail } = require("../lib/orders");
const { markOf, markQuoteOf } = require("../lib/mark-prices");
const { getAccountBalance } = require("../lib/account-balance-read");
const { envelope, quoteQuality, TTL, nowMs } = require("../lib/provenance");

const router = express.Router();

/**
 * GET /api/orders/mark?symbol=BTCUSDT
 * Mark price từ feed public (không secret) + freshness envelope.
 */
router.get("/mark", requireAuth, requirePermission(PERMISSIONS.ORDERS_VIEW), async (req, res) => {
    try {
        const symbol = String(req.query.symbol || "").trim().toUpperCase();
        if (!symbol) {
            res.status(400).json({ error: "Thiếu symbol" });
            return;
        }
        const quote = markQuoteOf(symbol);
        const mark = quote?.mark ?? markOf(symbol);
        const receivedAt = quote?.receivedAt ?? null;
        const quality = mark == null ? "missing" : quoteQuality(receivedAt, TTL.mark_quote_trading);
        const expiresAt = receivedAt != null ? receivedAt + TTL.mark_quote_trading : null;
        res.json({
            symbol,
            mark: mark == null ? null : Number(mark),
            provenance: envelope({
                source: "mark-prices",
                sourceAt: quote?.sourceAt ?? receivedAt,
                receivedAt: receivedAt ?? nowMs(),
                quality,
                missingFields: mark == null ? ["mark"] : [],
                expiresAt,
                coverage: { ttlMs: TTL.mark_quote_trading },
            }),
            expiresAt,
            quality,
        });
    } catch (error) {
        sendError(res, error, "GET /api/orders/mark");
    }
});

/**
 * GET /api/orders/balance?account=&env=
 * availableBalance Redis wb:bal — phục vụ sizing % ví trên Terminal.
 * Cần orders.view hoặc positions.view + scope bot (lib kiểm tra).
 */
router.get("/balance", requireAuth, async (req, res) => {
    try {
        const perms = req.webUser?.permissions || [];
        if (!perms.includes(PERMISSIONS.ORDERS_VIEW) && !perms.includes(PERMISSIONS.POSITIONS_VIEW)) {
            res.status(403).json({ error: "Không có quyền" });
            return;
        }
        res.json(await getAccountBalance(req.webUser, {
            account: req.query.account,
            env: req.query.env,
        }));
    } catch (error) {
        sendError(res, error, "GET /api/orders/balance");
    }
});

/**
 * GET /api/orders/open
 * Lấy danh sách order đang mở từ Redis snapshot.
 * Permission: orders.view
 */
router.get("/open", requireAuth, requirePermission(PERMISSIONS.ORDERS_VIEW), async (req, res) => {
    try {
        const result = await loadOpenOrders(req.webUser, req.query);
        res.json(result);
    } catch (error) {
        sendError(res, error, "GET /api/orders/open");
    }
});

/**
 * GET /api/orders/history
 * Lấy lịch sử order từ Mongo với pagination.
 * Permission: orders.view
 * Query: account, symbol, kind, side, positionSide, type, status, from, to, page, limit, sort, dir
 */
router.get("/history", requireAuth, requirePermission(PERMISSIONS.ORDERS_VIEW), async (req, res) => {
    try {
        const result = await loadOrderHistory(req.webUser, req.query);
        res.json(result);
    } catch (error) {
        sendError(res, error, "GET /api/orders/history");
    }
});

/**
 * GET /api/orders/:kind/:symbol/:orderId
 * Lấy chi tiết một order và fills liên quan.
 * Permission: orders.view
 */
router.get("/:kind/:symbol/:orderId", requireAuth, requirePermission(PERMISSIONS.ORDERS_VIEW), async (req, res) => {
    try {
        const result = await getOrderDetail(req.webUser, {
            kind: req.params.kind,
            symbol: req.params.symbol,
            orderId: req.params.orderId,
            account: req.query.account,
        });
        res.json(result);
    } catch (error) {
        sendError(res, error, "GET /api/orders/:kind/:symbol/:orderId");
    }
});

module.exports = router;
