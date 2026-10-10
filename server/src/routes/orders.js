/**
 * Orders API routes - Phase A: Read-only
 * Spec: trading-terminal-spec.md mục 12.2
 */
const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { PERMISSIONS } = require("../auth/access-control");
const { sendError } = require("../lib/http");
const { loadOpenOrders, loadOrderHistory, getOrderDetail } = require("../lib/orders");

const router = express.Router();

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
