const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { PERMISSIONS } = require("../auth/access-control");
const { sendError } = require("../lib/http");
const {
    createTrack,
    listTracks,
    patchTrack,
    listInbox,
    markInboxRead,
    evaluateTrackObservation,
} = require("../lib/research-inbox");
const {
    createScanner,
    listScanners,
    patchScanner,
    runScannerAlert,
} = require("../lib/market-scanner");
const { listTimeline, appendTradeEvent } = require("../lib/trade-events");

const router = express.Router();

router.get("/tracks", requireAuth, requirePermission(PERMISSIONS.MARKET_VIEW), async (req, res) => {
    try {
        res.json(await listTracks(req.webUser, req.query));
    } catch (error) {
        sendError(res, error, "GET /api/research/tracks");
    }
});

router.post("/tracks", requireAuth, requirePermission(PERMISSIONS.MARKET_VIEW), async (req, res) => {
    try {
        const track = await createTrack(req.webUser, req.body || {});
        res.status(201).json({ track });
    } catch (error) {
        sendError(res, error, "POST /api/research/tracks");
    }
});

router.patch("/tracks/:id", requireAuth, requirePermission(PERMISSIONS.MARKET_VIEW), async (req, res) => {
    try {
        res.json({ track: await patchTrack(req.webUser, req.params.id, req.body || {}) });
    } catch (error) {
        sendError(res, error, "PATCH /api/research/tracks/:id");
    }
});

/** Worker/test hook — đánh giá observation (không gọi sàn). */
router.post("/tracks/:id/observe", requireAuth, requirePermission(PERMISSIONS.MARKET_VIEW), async (req, res) => {
    try {
        res.json(await evaluateTrackObservation(req.params.id, req.body || {}));
    } catch (error) {
        sendError(res, error, "POST /api/research/tracks/:id/observe");
    }
});

router.get("/inbox", requireAuth, requirePermission(PERMISSIONS.MARKET_VIEW), async (req, res) => {
    try {
        // Cho phép positions.view đọc inbox nếu không có market.view? Spec: actor scoped.
        res.json(await listInbox(req.webUser, req.query));
    } catch (error) {
        sendError(res, error, "GET /api/research/inbox");
    }
});

router.patch("/inbox/:id/read", requireAuth, requirePermission(PERMISSIONS.MARKET_VIEW), async (req, res) => {
    try {
        res.json({ item: await markInboxRead(req.webUser, req.params.id) });
    } catch (error) {
        sendError(res, error, "PATCH /api/research/inbox/:id/read");
    }
});

router.get("/scanners", requireAuth, requirePermission(PERMISSIONS.MARKET_VIEW), async (req, res) => {
    try {
        res.json(await listScanners(req.webUser));
    } catch (error) {
        sendError(res, error, "GET /api/research/scanners");
    }
});

router.post("/scanners", requireAuth, requirePermission(PERMISSIONS.MARKET_VIEW), async (req, res) => {
    try {
        res.status(201).json({ scanner: await createScanner(req.webUser, req.body || {}) });
    } catch (error) {
        sendError(res, error, "POST /api/research/scanners");
    }
});

router.patch("/scanners/:id", requireAuth, requirePermission(PERMISSIONS.MARKET_VIEW), async (req, res) => {
    try {
        res.json({ scanner: await patchScanner(req.webUser, req.params.id, req.body || {}) });
    } catch (error) {
        sendError(res, error, "PATCH /api/research/scanners/:id");
    }
});

router.post("/scanners/:id/run", requireAuth, requirePermission(PERMISSIONS.MARKET_VIEW), async (req, res) => {
    try {
        const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
        res.json(await runScannerAlert(req.webUser, req.params.id, rows, {
            candleClosed: req.body?.candleClosed !== false,
            transitionKey: req.body?.transitionKey,
        }));
    } catch (error) {
        sendError(res, error, "POST /api/research/scanners/:id/run");
    }
});

router.get("/timeline", requireAuth, requirePermission(PERMISSIONS.POSITIONS_VIEW), async (req, res) => {
    try {
        res.json(await listTimeline(req.query));
    } catch (error) {
        sendError(res, error, "GET /api/research/timeline");
    }
});

router.post("/timeline/events", requireAuth, requirePermission(PERMISSIONS.POSITIONS_VIEW), async (req, res) => {
    try {
        const result = await appendTradeEvent({
            ...req.body,
            actorId: req.webUser?.id,
            producer: req.body?.producer || "web",
        });
        res.status(result.created ? 201 : 200).json(result);
    } catch (error) {
        sendError(res, error, "POST /api/research/timeline/events");
    }
});

module.exports = router;
