const express = require("express");
const { requireAuth, requirePermission, canAccessBot } = require("../middleware/auth");
const { PERMISSIONS, hasPermission } = require("../auth/access-control");
const { sendError, httpError } = require("../lib/http");
const { listNotes, createNote, updateNote, deleteNote } = require("../lib/trade-journal");
const {
    runPositionDecision,
    runAccountDecision,
    listReports,
    latestAccountReport,
} = require("../lib/decision-support/run-decision");

const router = express.Router();

function requirePositionsOrStats(req, res, next) {
    if (hasPermission(req.webUser, PERMISSIONS.POSITIONS_VIEW)
        || hasPermission(req.webUser, PERMISSIONS.STATISTICS_VIEW)) {
        return next();
    }
    return res.status(403).json({ error: "Không có quyền" });
}

/**
 * GET /api/terminal/journal?account=&symbol=&side=&tradeKey=
 * Ghi chú cá nhân của actor — cần positions.view + scope bot.
 */
router.get("/journal", requireAuth, requirePermission(PERMISSIONS.POSITIONS_VIEW), async (req, res) => {
    try {
        res.json(await listNotes(req.webUser, req.query));
    } catch (error) {
        sendError(res, error, "GET /api/terminal/journal");
    }
});

router.post("/journal", requireAuth, requirePermission(PERMISSIONS.POSITIONS_VIEW), async (req, res) => {
    try {
        const note = await createNote(req.webUser, req.body || {});
        res.status(201).json({ note });
    } catch (error) {
        sendError(res, error, "POST /api/terminal/journal");
    }
});

router.patch("/journal/:id", requireAuth, requirePermission(PERMISSIONS.POSITIONS_VIEW), async (req, res) => {
    try {
        const note = await updateNote(req.webUser, req.params.id, req.body || {});
        res.json({ note });
    } catch (error) {
        sendError(res, error, "PATCH /api/terminal/journal/:id");
    }
});

router.delete("/journal/:id", requireAuth, requirePermission(PERMISSIONS.POSITIONS_VIEW), async (req, res) => {
    try {
        res.json(await deleteNote(req.webUser, req.params.id));
    } catch (error) {
        sendError(res, error, "DELETE /api/terminal/journal/:id");
    }
});

/**
 * POST /api/terminal/decision/position
 * Body: { account, symbol, side, ...metrics fields } hoặc { position: {...}, ai?: boolean }
 */
router.post("/decision/position", requireAuth, requirePermission(PERMISSIONS.POSITIONS_VIEW), async (req, res) => {
    try {
        const result = await runPositionDecision(req.webUser, req.body || {});
        res.json(result);
    } catch (error) {
        if (error.status === 429) {
            res.status(429).json({ error: error.message, retryAfter: error.retryAfter });
            return;
        }
        sendError(res, error, "POST /api/terminal/decision/position");
    }
});

/**
 * POST /api/terminal/decision/account
 * Body: { username|account, ai?: boolean }
 */
router.post("/decision/account", requireAuth, requirePositionsOrStats, async (req, res) => {
    try {
        const account = String(req.body?.username || req.body?.account || "").trim();
        if (account
            && !canAccessBot(req.webUser, account, PERMISSIONS.POSITIONS_VIEW)
            && !canAccessBot(req.webUser, account, PERMISSIONS.STATISTICS_VIEW)) {
            throw httpError(403, "Không có quyền với bot này");
        }
        const result = await runAccountDecision(req.webUser, req.body || {});
        res.json(result);
    } catch (error) {
        if (error.status === 429) {
            res.status(429).json({ error: error.message, retryAfter: error.retryAfter });
            return;
        }
        sendError(res, error, "POST /api/terminal/decision/account");
    }
});

/**
 * GET /api/terminal/decision/reports?scope=&account=&tradeKey=&limit=
 */
router.get("/decision/reports", requireAuth, requirePermission(PERMISSIONS.POSITIONS_VIEW), async (req, res) => {
    try {
        res.json(await listReports(req.webUser, req.query));
    } catch (error) {
        sendError(res, error, "GET /api/terminal/decision/reports");
    }
});

/**
 * GET /api/terminal/decision/latest-account?account=
 * Đọc cache báo cáo account gần nhất (dashboard badge — không gọi AI).
 */
router.get("/decision/latest-account", requireAuth, requirePermission(PERMISSIONS.POSITIONS_VIEW), async (req, res) => {
    try {
        const report = await latestAccountReport(req.webUser, req.query.account);
        res.json({ report });
    } catch (error) {
        sendError(res, error, "GET /api/terminal/decision/latest-account");
    }
});

/**
 * POST /api/terminal/coach — wrapper tương thích: chuyển sang decision pipeline.
 * Body: { position, ai?: boolean }
 */
router.post("/coach", requireAuth, requirePermission(PERMISSIONS.POSITIONS_VIEW), async (req, res) => {
    try {
        const position = req.body?.position;
        if (!position || typeof position !== "object") throw httpError(400, "Thiếu position");
        const result = await runPositionDecision(req.webUser, {
            ...position,
            position,
            ai: req.body?.ai !== false,
        });
        // Shape cũ tối thiểu để UI cũ không vỡ nếu còn cache
        const report = result.report || {};
        res.json({
            ...result,
            factors: result.snapshot?.metrics || null,
            suggestions: (report.priorities || []).map((p) => ({
                title: p.action,
                detail: [p.why, p.impact].filter(Boolean).join(" — "),
                kind: "risk",
            })),
            levels: result.snapshot?.market?.levels || [],
            source: report.meta?.source || "rules",
            configured: result.configured,
            message: report.summary,
        });
    } catch (error) {
        if (error.status === 429) {
            res.status(429).json({ error: error.message, retryAfter: error.retryAfter });
            return;
        }
        sendError(res, error, "POST /api/terminal/coach");
    }
});

module.exports = router;
