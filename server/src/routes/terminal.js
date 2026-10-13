const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { PERMISSIONS } = require("../auth/access-control");
const { sendError, httpError } = require("../lib/http");
const { listNotes, createNote, updateNote, deleteNote } = require("../lib/trade-journal");
const { analyzeLocal, askTradeCoach } = require("../lib/trade-coach");

const router = express.Router();
const lastCoach = new Map();

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
 * POST /api/terminal/coach
 * Body: { position: {...}, ai?: boolean }
 * Phân tích factors + gợi ý rule/AI. Rate limit 15s/user khi gọi AI.
 */
router.post("/coach", requireAuth, requirePermission(PERMISSIONS.POSITIONS_VIEW), async (req, res) => {
    try {
        const position = req.body?.position;
        if (!position || typeof position !== "object") throw httpError(400, "Thiếu position");
        const account = String(position.account || "").trim();
        if (!account) throw httpError(400, "Thiếu account trong position");
        const { canAccessBot } = require("../middleware/auth");
        if (!canAccessBot(req.webUser, account, PERMISSIONS.POSITIONS_VIEW)) {
            throw httpError(403, "Không có quyền với bot này");
        }

        const wantAi = req.body?.ai !== false;
        if (!wantAi) {
            res.json(analyzeLocal(position));
            return;
        }
        const id = String(req.webUser?.id || "");
        const now = Date.now();
        if (now - (lastCoach.get(id) || 0) < 15000) {
            const local = analyzeLocal(position);
            res.status(429).json({ error: "Đợi một chút rồi hỏi AI lại", ...local });
            return;
        }
        lastCoach.set(id, now);
        res.json(await askTradeCoach(position));
    } catch (error) {
        sendError(res, error, "POST /api/terminal/coach");
    }
});

module.exports = router;
