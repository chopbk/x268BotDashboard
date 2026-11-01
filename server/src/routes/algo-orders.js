const express = require("express");
const { requireAuth, requirePermission, canAccessBot } = require("../middleware/auth");
const { PERMISSIONS } = require("../auth/access-control");
const { sendError, httpError } = require("../lib/http");
const {
    createAlgoOrder,
    getAlgoOrder,
    pauseAlgo,
    cancelAlgo,
    reconcileAlgo,
    microstructureCapabilities,
} = require("../lib/trading/algo-orders");

const router = express.Router();

router.get("/microstructure/capabilities", requireAuth, requirePermission(PERMISSIONS.ORDERS_VIEW), (_req, res) => {
    res.json(microstructureCapabilities());
});

router.post("/", requireAuth, requirePermission(PERMISSIONS.ORDERS_CREATE), async (req, res) => {
    try {
        const account = String(req.body?.account || req.body?.username || "").trim();
        if (!account || !canAccessBot(req.webUser, account, PERMISSIONS.ORDERS_CREATE)) {
            throw httpError(403, "Không có quyền");
        }
        const result = await createAlgoOrder(req.webUser, { ...req.body, account });
        if (result.rejected) return res.status(409).json(result);
        res.status(201).json(result);
    } catch (error) {
        sendError(res, error, "POST /api/trading/algo-orders");
    }
});

router.get("/:algoId", requireAuth, requirePermission(PERMISSIONS.ORDERS_VIEW), async (req, res) => {
    try {
        res.json({ algo: await getAlgoOrder(req.webUser, req.params.algoId) });
    } catch (error) {
        sendError(res, error, "GET /api/trading/algo-orders/:id");
    }
});

router.post("/:algoId/pause", requireAuth, requirePermission(PERMISSIONS.ORDERS_EDIT), async (req, res) => {
    try {
        res.json({ algo: await pauseAlgo(req.webUser, req.params.algoId) });
    } catch (error) {
        sendError(res, error, "POST pause algo");
    }
});

router.post("/:algoId/cancel", requireAuth, requirePermission(PERMISSIONS.ORDERS_CANCEL), async (req, res) => {
    try {
        res.json(await cancelAlgo(req.webUser, req.params.algoId));
    } catch (error) {
        sendError(res, error, "POST cancel algo");
    }
});

router.post("/:algoId/reconcile", requireAuth, requirePermission(PERMISSIONS.ORDERS_EDIT), async (req, res) => {
    try {
        res.json({
            algo: await reconcileAlgo(req.webUser, req.params.algoId, {
                exchangeChildren: req.body?.exchangeChildren || [],
            }),
        });
    } catch (error) {
        sendError(res, error, "POST reconcile algo");
    }
});

module.exports = router;
