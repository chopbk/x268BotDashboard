const express = require("express");
const { requireAuth, requirePermission, canAccessBot } = require("../middleware/auth");
const { PERMISSIONS, hasPermission } = require("../auth/access-control");
const { sendError, httpError } = require("../lib/http");
const { buildPortfolioSnapshot, buildShockScenarios } = require("../lib/risk-portfolio");
const {
    listPolicies,
    upsertPolicy,
    getPolicyForAccount,
    ackProducer,
    listProducerAcks,
} = require("../lib/risk-policy");
const {
    reserveBudget,
    bindReservation,
    releaseReservation,
    loadActiveReservations,
    getReservation,
} = require("../lib/risk-reservation");
const { runRiskControl } = require("../lib/risk-controls");
const { loadPositions } = require("../lib/positions");
const { getAccountBalance } = require("../lib/account-balance-read");

const router = express.Router();

function requireRiskRead(req, res, next) {
    if (hasPermission(req.webUser, PERMISSIONS.POSITIONS_VIEW)
        || hasPermission(req.webUser, PERMISSIONS.STATISTICS_VIEW)
        || hasPermission(req.webUser, PERMISSIONS.RISK_MANAGE)) {
        return next();
    }
    return res.status(403).json({ error: "Không có quyền" });
}

/**
 * GET /api/risk/portfolio?username=
 */
router.get("/portfolio", requireAuth, requireRiskRead, async (req, res) => {
    try {
        const username = String(req.query.username || "").trim();
        if (!username) throw httpError(400, "Thiếu username");
        if (!canAccessBot(req.webUser, username, PERMISSIONS.POSITIONS_VIEW)
            && !canAccessBot(req.webUser, username, PERMISSIONS.STATISTICS_VIEW)
            && !canAccessBot(req.webUser, username, PERMISSIONS.RISK_MANAGE)) {
            throw httpError(403, "Không có quyền với tài khoản này");
        }

        let positions = [];
        let wallet = null;
        try {
            const fast = await loadPositions(req.webUser, {
                account: username,
                audience: "mine",
                book: "",
            }, { mode: "fast" });
            positions = (fast?.rows || []).filter((r) => r.account === username);
        } catch (err) {
            // partial
        }
        try {
            wallet = await getAccountBalance(req.webUser, { account: username });
        } catch {
            wallet = null;
        }
        const reservations = await loadActiveReservations(username);
        const snapshot = buildPortfolioSnapshot({
            username,
            positions,
            wallet,
            reservations,
            cashflows: req.query.includeCashflows === "1" ? null : null,
        });
        const policy = await getPolicyForAccount(username);
        res.json({
            snapshot,
            policy,
            reservations: reservations.map((r) => ({
                reservationId: r.reservationId,
                status: r.status,
                notionalNeed: r.notionalNeed,
                producer: r.producer,
                leaseUntil: r.leaseUntil,
            })),
        });
    } catch (error) {
        sendError(res, error, "GET /api/risk/portfolio");
    }
});

router.post("/scenarios", requireAuth, requireRiskRead, async (req, res) => {
    try {
        const username = String(req.body?.username || "").trim();
        if (!username) throw httpError(400, "Thiếu username");
        if (!canAccessBot(req.webUser, username, PERMISSIONS.POSITIONS_VIEW)
            && !canAccessBot(req.webUser, username, PERMISSIONS.RISK_MANAGE)) {
            throw httpError(403, "Không có quyền với tài khoản này");
        }
        let positions = [];
        try {
            const fast = await loadPositions(req.webUser, {
                account: username,
                audience: "mine",
                book: "",
            }, { mode: "fast" });
            positions = (fast?.rows || []).filter((r) => r.account === username);
        } catch {
            positions = Array.isArray(req.body?.positions) ? req.body.positions : [];
        }
        const snapshot = buildPortfolioSnapshot({
            username,
            positions,
            wallet: req.body?.wallet || null,
        });
        res.json({ snapshot, ...buildShockScenarios(snapshot, req.body || {}) });
    } catch (error) {
        sendError(res, error, "POST /api/risk/scenarios");
    }
});

router.get("/policies", requireAuth, requirePermission(PERMISSIONS.RISK_MANAGE), async (req, res) => {
    try {
        res.json(await listPolicies({ username: req.query.username }));
    } catch (error) {
        sendError(res, error, "GET /api/risk/policies");
    }
});

router.put("/policies/:policyId?", requireAuth, requirePermission(PERMISSIONS.RISK_MANAGE), async (req, res) => {
    try {
        const username = String(req.body?.username || req.body?.scope?.username || "").trim();
        if (username && !canAccessBot(req.webUser, username, PERMISSIONS.RISK_MANAGE)) {
            throw httpError(403, "Không có quyền với tài khoản này");
        }
        const policy = await upsertPolicy(req.webUser, {
            ...req.body,
            policyId: req.params.policyId || req.body?.policyId,
        });
        res.json({ policy });
    } catch (error) {
        sendError(res, error, "PUT /api/risk/policies");
    }
});

router.get("/policies/:policyId/acks", requireAuth, requirePermission(PERMISSIONS.RISK_MANAGE), async (req, res) => {
    try {
        res.json(await listProducerAcks(req.params.policyId));
    } catch (error) {
        sendError(res, error, "GET /api/risk/policies/:id/acks");
    }
});

/** Bot / internal producer ACK — vẫn cần auth web user hoặc sẽ mở service token sau. */
router.post("/acks", requireAuth, requirePermission(PERMISSIONS.RISK_MANAGE), async (req, res) => {
    try {
        res.status(201).json({ ack: await ackProducer(req.body || {}) });
    } catch (error) {
        sendError(res, error, "POST /api/risk/acks");
    }
});

router.post("/reservations", requireAuth, async (req, res) => {
    try {
        const username = String(req.body?.account || req.body?.username || "").trim();
        if (!username) throw httpError(400, "Thiếu account");
        const canTrade = canAccessBot(req.webUser, username, PERMISSIONS.POSITIONS_OPEN)
            || canAccessBot(req.webUser, username, PERMISSIONS.ORDERS_CREATE)
            || canAccessBot(req.webUser, username, PERMISSIONS.RISK_MANAGE);
        if (!canTrade) throw httpError(403, "Không có quyền");
        const result = await reserveBudget({
            ...req.body,
            account: username,
            producer: req.body?.producer || "web-api",
            positions: req.body?.positions || [],
            wallet: req.body?.wallet || null,
            openOrders: req.body?.openOrders || [],
        });
        const status = result.allowed ? 201 : 409;
        res.status(status).json(result);
    } catch (error) {
        sendError(res, error, "POST /api/risk/reservations");
    }
});

async function assertReservationAccess(actor, reservationId) {
    const doc = await getReservation(reservationId);
    if (!doc) throw httpError(404, "Không tìm thấy reservation");
    const account = String(doc.account || "").trim();
    const can = canAccessBot(actor, account, PERMISSIONS.POSITIONS_OPEN)
        || canAccessBot(actor, account, PERMISSIONS.ORDERS_CREATE)
        || canAccessBot(actor, account, PERMISSIONS.RISK_MANAGE);
    if (!can) throw httpError(403, "Không có quyền với reservation này");
    return doc;
}

router.post("/reservations/:id/bind", requireAuth, async (req, res) => {
    try {
        await assertReservationAccess(req.webUser, req.params.id);
        // Public: chỉ gắn requestId sau submit; không nhận status client (đặc biệt unknown→submitted)
        res.json({
            reservation: await bindReservation(req.params.id, {
                requestId: req.body?.requestId,
                clientOrderId: req.body?.clientOrderId,
                exchangeOrderId: req.body?.exchangeOrderId,
            }, { reconcile: false }),
        });
    } catch (error) {
        sendError(res, error, "POST /api/risk/reservations/:id/bind");
    }
});

router.post("/reservations/:id/release", requireAuth, async (req, res) => {
    try {
        await assertReservationAccess(req.webUser, req.params.id);
        // Public chỉ release reserved/observed; unknown/submitted/partial → reconcile nội bộ
        res.json({
            reservation: await releaseReservation(req.params.id, {}, { reconcile: false }),
        });
    } catch (error) {
        sendError(res, error, "POST /api/risk/reservations/:id/release");
    }
});

router.post("/controls", requireAuth, requirePermission(PERMISSIONS.RISK_MANAGE), async (req, res) => {
    try {
        const username = String(req.body?.username || "").trim();
        if (username && !canAccessBot(req.webUser, username, PERMISSIONS.RISK_MANAGE)) {
            throw httpError(403, "Không có quyền với tài khoản này");
        }
        const result = await runRiskControl(req.webUser, req.body || {});
        res.status(202).json(result);
    } catch (error) {
        sendError(res, error, "POST /api/risk/controls");
    }
});

module.exports = router;
