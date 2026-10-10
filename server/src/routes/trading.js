/**
 * Trading API routes.
 * Spec: trading-terminal-spec.md mục 12
 * 
 * Phase B: ORDER_CANCEL
 * Phase C: TP/SL
 * Phase D: Close position
 * Phase E: Open position
 * Phase F: Replace/Reverse
 */
const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { PERMISSIONS } = require("../auth/access-control");
const { sendError, httpError } = require("../lib/http");
const { safeRecordAudit } = require("../lib/audit");
const {
    cancelOrder,
    cancelOrderBatch,
    getTradingCommand,
    createTradingRequest,
} = require("../lib/trading-bridge");

const router = express.Router();

/**
 * POST /api/trading/orders/cancel
 * Cancel một order.
 * Permission: orders.cancel
 */
router.post("/orders/cancel", requireAuth, requirePermission(PERMISSIONS.ORDERS_CANCEL), async (req, res) => {
    try {
        const { username, kind, symbol, orderId, env, expected, idempotencyKey } = req.body || {};

        if (!username) throw httpError(400, "Thiếu username");
        if (!kind) throw httpError(400, "Thiếu kind (regular/algo)");
        if (!symbol) throw httpError(400, "Thiếu symbol");
        if (!orderId) throw httpError(400, "Thiếu orderId");

        const result = await cancelOrder(req.webUser, {
            username,
            kind,
            symbol,
            orderId,
            env,
            expected,
            idempotencyKey,
        });

        if (!result.duplicate) {
            await safeRecordAudit({
                action: "order.cancel_requested",
                actor: req.webUser,
                targetType: "order",
                target: { username, symbol, orderId, kind },
                changes: {
                    requestId: { from: null, to: result.command?.requestId },
                },
            });
        }

        res.status(result.duplicate ? 200 : 202).json({
            command: result.command,
            duplicate: result.duplicate,
        });
    } catch (error) {
        sendError(res, error, "POST /api/trading/orders/cancel");
    }
});

/**
 * POST /api/trading/orders/cancel-batch
 * Cancel nhiều orders (tối đa 20).
 * Permission: orders.cancel
 */
router.post("/orders/cancel-batch", requireAuth, requirePermission(PERMISSIONS.ORDERS_CANCEL), async (req, res) => {
    try {
        const { username, orders, env, idempotencyKey } = req.body || {};

        if (!username) throw httpError(400, "Thiếu username");
        if (!Array.isArray(orders) || !orders.length) throw httpError(400, "Cần mảng orders");

        const result = await cancelOrderBatch(req.webUser, {
            username,
            orders,
            env,
            idempotencyKey,
        });

        if (!result.duplicate) {
            await safeRecordAudit({
                action: "order.cancel_batch_requested",
                actor: req.webUser,
                targetType: "order",
                target: { username, count: orders.length },
                changes: {
                    requestId: { from: null, to: result.command?.requestId },
                },
            });
        }

        res.status(result.duplicate ? 200 : 202).json({
            command: result.command,
            duplicate: result.duplicate,
        });
    } catch (error) {
        sendError(res, error, "POST /api/trading/orders/cancel-batch");
    }
});

/**
 * GET /api/trading/commands/:requestId
 * Lấy trạng thái trading command.
 */
router.get("/commands/:requestId", requireAuth, async (req, res) => {
    try {
        const command = await getTradingCommand(req.webUser, req.params.requestId);
        res.json({ command });
    } catch (error) {
        sendError(res, error, "GET /api/trading/commands/:requestId");
    }
});

/**
 * PUT /api/trading/positions/:positionKey/tpsl
 * Tạo hoặc thay TP/SL cho position.
 * Permission: positions.tpsl
 * Phase C
 */
router.put("/positions/:positionKey/tpsl", requireAuth, requirePermission(PERMISSIONS.POSITIONS_TPSL), async (req, res) => {
    try {
        const [username, symbol, positionSide] = (req.params.positionKey || "").split("|");
        if (!username || !symbol || !positionSide) {
            throw httpError(400, "positionKey phải có format username|symbol|positionSide");
        }

        const result = await createTradingRequest({
            actor: req.webUser,
            action: "POSITION_SET_TPSL",
            target: {
                username,
                symbol: symbol.toUpperCase(),
                positionSide: positionSide.toUpperCase(),
                env: req.body?.env,
            },
            params: req.body || {},
            expected: req.body?.expected,
            idempotencyKey: req.body?.idempotencyKey,
        });

        if (!result.duplicate) {
            await safeRecordAudit({
                action: "position.tpsl_requested",
                actor: req.webUser,
                targetType: "position",
                target: { username, symbol, positionSide },
                changes: {
                    requestId: { from: null, to: result.command?.requestId },
                },
            });
        }

        res.status(result.duplicate ? 200 : 202).json({
            command: result.command,
            duplicate: result.duplicate,
        });
    } catch (error) {
        sendError(res, error, "PUT /api/trading/positions/:positionKey/tpsl");
    }
});

/**
 * DELETE /api/trading/positions/:positionKey/tpsl/:kind/:orderId
 * Hủy TP/SL cụ thể.
 * Permission: positions.tpsl
 * Phase C
 */
router.delete("/positions/:positionKey/tpsl/:kind/:orderId", requireAuth, requirePermission(PERMISSIONS.POSITIONS_TPSL), async (req, res) => {
    try {
        const [username, symbol, positionSide] = (req.params.positionKey || "").split("|");
        if (!username || !symbol || !positionSide) {
            throw httpError(400, "positionKey phải có format username|symbol|positionSide");
        }

        const result = await createTradingRequest({
            actor: req.webUser,
            action: "POSITION_CANCEL_TPSL",
            target: {
                username,
                symbol: symbol.toUpperCase(),
                positionSide: positionSide.toUpperCase(),
            },
            params: {
                kind: req.params.kind,
                orderId: req.params.orderId,
            },
            idempotencyKey: req.query?.idempotencyKey,
        });

        res.status(result.duplicate ? 200 : 202).json({
            command: result.command,
            duplicate: result.duplicate,
        });
    } catch (error) {
        sendError(res, error, "DELETE /api/trading/positions/:positionKey/tpsl/:kind/:orderId");
    }
});

/**
 * POST /api/trading/positions/close
 * Đóng vị thế.
 * Permission: positions.close
 * Phase D
 */
router.post("/positions/close", requireAuth, requirePermission(PERMISSIONS.POSITIONS_CLOSE), async (req, res) => {
    try {
        const { username, symbol, positionSide, env, orderType, quantityMode, quantity, percent, price, expected, idempotencyKey } = req.body || {};

        if (!username) throw httpError(400, "Thiếu username");
        if (!symbol) throw httpError(400, "Thiếu symbol");
        if (!positionSide) throw httpError(400, "Thiếu positionSide");

        const result = await createTradingRequest({
            actor: req.webUser,
            action: "POSITION_CLOSE",
            target: {
                username,
                symbol: symbol.toUpperCase(),
                positionSide: positionSide.toUpperCase(),
                env,
            },
            params: {
                orderType: orderType || "MARKET",
                quantityMode: quantityMode || "ALL",
                quantity,
                percent,
                price,
            },
            expected,
            idempotencyKey,
        });

        if (!result.duplicate) {
            await safeRecordAudit({
                action: "position.close_requested",
                actor: req.webUser,
                targetType: "position",
                target: { username, symbol, positionSide },
                changes: {
                    requestId: { from: null, to: result.command?.requestId },
                    orderType: { from: null, to: orderType || "MARKET" },
                    quantityMode: { from: null, to: quantityMode || "ALL" },
                },
            });
        }

        res.status(result.duplicate ? 200 : 202).json({
            command: result.command,
            duplicate: result.duplicate,
        });
    } catch (error) {
        sendError(res, error, "POST /api/trading/positions/close");
    }
});

/**
 * POST /api/trading/positions/open
 * Mở vị thế mới.
 * Permission: positions.open
 * Phase E
 */
router.post("/positions/open", requireAuth, requirePermission(PERMISSIONS.POSITIONS_OPEN), async (req, res) => {
    try {
        const { username, symbol, positionSide, env, orderType, quantity, price, expected, idempotencyKey } = req.body || {};

        if (!username) throw httpError(400, "Thiếu username");
        if (!symbol) throw httpError(400, "Thiếu symbol");
        if (!positionSide) throw httpError(400, "Thiếu positionSide");
        if (!quantity) throw httpError(400, "Thiếu quantity");

        const result = await createTradingRequest({
            actor: req.webUser,
            action: "POSITION_OPEN",
            target: {
                username,
                symbol: symbol.toUpperCase(),
                positionSide: positionSide.toUpperCase(),
                env,
            },
            params: {
                orderType: orderType || "MARKET",
                quantity,
                price,
            },
            expected,
            idempotencyKey,
        });

        if (!result.duplicate) {
            await safeRecordAudit({
                action: "position.open_requested",
                actor: req.webUser,
                targetType: "position",
                target: { username, symbol, positionSide },
                changes: {
                    requestId: { from: null, to: result.command?.requestId },
                    orderType: { from: null, to: orderType || "MARKET" },
                    quantity: { from: null, to: quantity },
                },
            });
        }

        res.status(result.duplicate ? 200 : 202).json({
            command: result.command,
            duplicate: result.duplicate,
        });
    } catch (error) {
        sendError(res, error, "POST /api/trading/positions/open");
    }
});

/**
 * POST /api/trading/positions/reverse
 * Reverse vị thế.
 * Permission: positions.open + positions.close
 * Phase F
 */
router.post("/positions/reverse", requireAuth, requirePermission(PERMISSIONS.POSITIONS_OPEN), requirePermission(PERMISSIONS.POSITIONS_CLOSE), async (req, res) => {
    try {
        const { username, symbol, positionSide, env, closeOrderType, openOrderType, newQuantity, expected, idempotencyKey } = req.body || {};

        if (!username) throw httpError(400, "Thiếu username");
        if (!symbol) throw httpError(400, "Thiếu symbol");
        if (!positionSide) throw httpError(400, "Thiếu positionSide");

        const result = await createTradingRequest({
            actor: req.webUser,
            action: "POSITION_REVERSE",
            target: {
                username,
                symbol: symbol.toUpperCase(),
                positionSide: positionSide.toUpperCase(),
                env,
            },
            params: {
                closeOrderType: closeOrderType || "MARKET",
                openOrderType: openOrderType || "MARKET",
                newQuantity,
            },
            expected,
            idempotencyKey,
        });

        if (!result.duplicate) {
            await safeRecordAudit({
                action: "position.reverse_requested",
                actor: req.webUser,
                targetType: "position",
                target: { username, symbol, positionSide },
                changes: {
                    requestId: { from: null, to: result.command?.requestId },
                },
            });
        }

        res.status(result.duplicate ? 200 : 202).json({
            command: result.command,
            duplicate: result.duplicate,
        });
    } catch (error) {
        sendError(res, error, "POST /api/trading/positions/reverse");
    }
});

/**
 * POST /api/trading/orders
 * Tạo order mới.
 * Permission: orders.create
 * Phase E+
 */
router.post("/orders", requireAuth, requirePermission(PERMISSIONS.ORDERS_CREATE), async (req, res) => {
    try {
        const { username, env, symbol, kind, side, positionSide, type, quantity, price, triggerPrice, expected, idempotencyKey } = req.body || {};

        if (!username) throw httpError(400, "Thiếu username");
        if (!symbol) throw httpError(400, "Thiếu symbol");

        const result = await createTradingRequest({
            actor: req.webUser,
            action: "ORDER_CREATE",
            target: {
                username,
                symbol: symbol.toUpperCase(),
                env,
            },
            params: {
                kind: kind || "regular",
                side,
                positionSide,
                type,
                quantity,
                price,
                triggerPrice,
            },
            expected,
            idempotencyKey,
        });

        if (!result.duplicate) {
            await safeRecordAudit({
                action: "order.create_requested",
                actor: req.webUser,
                targetType: "order",
                target: { username, symbol, side, type },
                changes: {
                    requestId: { from: null, to: result.command?.requestId },
                },
            });
        }

        res.status(result.duplicate ? 200 : 202).json({
            command: result.command,
            duplicate: result.duplicate,
        });
    } catch (error) {
        sendError(res, error, "POST /api/trading/orders");
    }
});

/**
 * PUT /api/trading/orders/:kind/:symbol/:orderId
 * Replace order.
 * Permission: orders.edit
 * Phase F
 */
router.put("/orders/:kind/:symbol/:orderId", requireAuth, requirePermission(PERMISSIONS.ORDERS_EDIT), async (req, res) => {
    try {
        const { kind, symbol, orderId } = req.params;
        const { username, env, expected, idempotencyKey, ...params } = req.body || {};

        if (!username) throw httpError(400, "Thiếu username");

        const result = await createTradingRequest({
            actor: req.webUser,
            action: "ORDER_REPLACE",
            target: {
                username,
                symbol: symbol.toUpperCase(),
                env,
            },
            params: {
                kind,
                orderId,
                symbol,
                ...params,
            },
            expected,
            idempotencyKey,
        });

        if (!result.duplicate) {
            await safeRecordAudit({
                action: "order.replace_requested",
                actor: req.webUser,
                targetType: "order",
                target: { username, symbol, orderId, kind },
                changes: {
                    requestId: { from: null, to: result.command?.requestId },
                },
            });
        }

        res.status(result.duplicate ? 200 : 202).json({
            command: result.command,
            duplicate: result.duplicate,
        });
    } catch (error) {
        sendError(res, error, "PUT /api/trading/orders/:kind/:symbol/:orderId");
    }
});

module.exports = router;
