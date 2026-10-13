const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { sendError } = require("../lib/http");
const processAdmin = require("../lib/process-admin");

const router = express.Router();

function requireAdmin(req, res, next) {
    if (req.webUser?.role !== "admin") {
        return res.status(403).json({ error: "Chỉ admin" });
    }
    next();
}

router.use(requireAuth, requireAdmin);

router.get("/registry", async (req, res) => {
    try {
        const [registry, references] = await Promise.all([
            processAdmin.getRegistry(),
            processAdmin.getReferenceOptions(),
        ]);
        res.json({ registry, references, highRiskKeys: [...processAdmin.HIGH_RISK] });
    } catch (error) {
        sendError(res, error, "GET /api/admin/processes/registry");
    }
});

router.get("/commands/:id", async (req, res) => {
    try {
        res.json(await processAdmin.getCommand(req.params.id));
    } catch (error) {
        sendError(res, error, "GET /api/admin/processes/commands/:id");
    }
});

router.get("/:env/revisions", async (req, res) => {
    try {
        res.json({ revisions: await processAdmin.listRevisions(req.params.env) });
    } catch (error) {
        sendError(res, error, "GET /api/admin/processes/:env/revisions");
    }
});

router.get("/:env/commands", async (req, res) => {
    try {
        res.json({ commands: await processAdmin.listCommandsForEnv(req.params.env) });
    } catch (error) {
        sendError(res, error, "GET /api/admin/processes/:env/commands");
    }
});

router.get("/:env", async (req, res) => {
    try {
        res.json(await processAdmin.getProfileDetail(req.params.env));
    } catch (error) {
        sendError(res, error, "GET /api/admin/processes/:env");
    }
});

router.patch("/:env", async (req, res) => {
    try {
        const result = await processAdmin.patchProfile(req.params.env, req.body || {}, req.webUser);
        if (result.errors) {
            return res.status(result.ok ? 200 : 400).json(result);
        }
        res.json(result);
    } catch (error) {
        if (error.status === 409 && error.current) {
            return res.status(409).json({ error: error.message, current: error.current });
        }
        if (error.status === 400 && error.errors) {
            return res.status(400).json({ error: error.message, errors: error.errors });
        }
        sendError(res, error, "PATCH /api/admin/processes/:env");
    }
});

router.post("/:env/rollback", async (req, res) => {
    try {
        res.json(await processAdmin.rollbackProfile(req.params.env, req.body || {}, req.webUser));
    } catch (error) {
        if (error.status === 400 && error.errors) {
            return res.status(400).json({ error: error.message, errors: error.errors });
        }
        sendError(res, error, "POST /api/admin/processes/:env/rollback");
    }
});

router.post("/:env/commands", async (req, res) => {
    try {
        res.status(201).json(await processAdmin.createCommand(req.params.env, req.body || {}, req.webUser));
    } catch (error) {
        sendError(res, error, "POST /api/admin/processes/:env/commands");
    }
});

module.exports = router;
