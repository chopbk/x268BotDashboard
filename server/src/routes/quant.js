const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { PERMISSIONS } = require("../auth/access-control");
const { sendError } = require("../lib/http");
const lab = require("../lib/quant/lab");

const router = express.Router();

const requireResearch = requirePermission(PERMISSIONS.RESEARCH_RUN);

router.get("/engines", requireAuth, requireResearch, (_req, res) => {
    res.json({ engines: lab.ENGINE_CATALOG });
});

router.get("/datasets", requireAuth, requireResearch, async (req, res) => {
    try {
        res.json(await lab.listDatasets(req.webUser));
    } catch (error) {
        sendError(res, error, "GET /api/quant/datasets");
    }
});

router.post("/datasets", requireAuth, requireResearch, async (req, res) => {
    try {
        res.status(201).json({ dataset: await lab.createDataset(req.webUser, req.body || {}) });
    } catch (error) {
        sendError(res, error, "POST /api/quant/datasets");
    }
});

router.get("/experiments", requireAuth, requireResearch, async (req, res) => {
    try {
        res.json(await lab.listExperiments(req.webUser));
    } catch (error) {
        sendError(res, error, "GET /api/quant/experiments");
    }
});

router.post("/experiments", requireAuth, requireResearch, async (req, res) => {
    try {
        res.status(201).json({ experiment: await lab.createExperiment(req.webUser, req.body || {}) });
    } catch (error) {
        sendError(res, error, "POST /api/quant/experiments");
    }
});

router.post("/experiments/:id/runs", requireAuth, requireResearch, async (req, res) => {
    try {
        const accepted = await lab.enqueueRun(req.webUser, req.params.id);
        res.status(202).json(accepted);
    } catch (error) {
        sendError(res, error, "POST /api/quant/experiments/:id/runs");
    }
});

router.get("/runs/:runId", requireAuth, requireResearch, async (req, res) => {
    try {
        res.json(await lab.getRun(req.webUser, req.params.runId));
    } catch (error) {
        sendError(res, error, "GET /api/quant/runs/:runId");
    }
});

router.post("/runs/:runId/cancel", requireAuth, requireResearch, async (req, res) => {
    try {
        res.json(await lab.cancelRun(req.webUser, req.params.runId));
    } catch (error) {
        sendError(res, error, "POST /api/quant/runs/:runId/cancel");
    }
});

router.post("/promotions", requireAuth, requireResearch, async (req, res) => {
    try {
        res.status(201).json(await lab.proposePromotion(req.webUser, req.body || {}));
    } catch (error) {
        sendError(res, error, "POST /api/quant/promotions");
    }
});

module.exports = router;
