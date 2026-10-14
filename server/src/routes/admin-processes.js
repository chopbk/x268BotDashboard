const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { PERMISSIONS, hasPermission } = require("../auth/access-control");
const { sendError } = require("../lib/http");
const processAdmin = require("../lib/process-admin");

const router = express.Router();

function requireProcessRead(req, res, next) {
    if (
        hasPermission(req.webUser, PERMISSIONS.PROCESSES_VIEW) ||
        hasPermission(req.webUser, PERMISSIONS.PROCESSES_EDIT) ||
        hasPermission(req.webUser, PERMISSIONS.PROCESSES_RESTART)
    ) {
        return next();
    }
    return res.status(403).json({ error: "Không có quyền xem process" });
}

router.use(requireAuth);

router.get("/registry", requireProcessRead, async (req, res) => {
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

router.get("/commands/:id", requireProcessRead, async (req, res) => {
    try {
        res.json(await processAdmin.getCommand(req.params.id));
    } catch (error) {
        sendError(res, error, "GET /api/admin/processes/commands/:id");
    }
});

router.get("/:env/revisions", requireProcessRead, async (req, res) => {
    try {
        res.json({ revisions: await processAdmin.listRevisions(req.params.env) });
    } catch (error) {
        sendError(res, error, "GET /api/admin/processes/:env/revisions");
    }
});

router.get("/:env/commands", requireProcessRead, async (req, res) => {
    try {
        res.json({ commands: await processAdmin.listCommandsForEnv(req.params.env) });
    } catch (error) {
        sendError(res, error, "GET /api/admin/processes/:env/commands");
    }
});

router.get("/:env", requireProcessRead, async (req, res) => {
    try {
        res.json(await processAdmin.getProfileDetail(req.params.env));
    } catch (error) {
        sendError(res, error, "GET /api/admin/processes/:env");
    }
});

router.patch("/:env", requirePermission(PERMISSIONS.PROCESSES_EDIT), async (req, res) => {
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

router.post("/:env/rollback", requirePermission(PERMISSIONS.PROCESSES_EDIT), async (req, res) => {
    try {
        res.json(await processAdmin.rollbackProfile(req.params.env, req.body || {}, req.webUser));
    } catch (error) {
        if (error.status === 400 && error.errors) {
            return res.status(400).json({ error: error.message, errors: error.errors });
        }
        sendError(res, error, "POST /api/admin/processes/:env/rollback");
    }
});

router.post("/:env/commands", requirePermission(PERMISSIONS.PROCESSES_RESTART), async (req, res) => {
    try {
        res.status(201).json(await processAdmin.createCommand(req.params.env, req.body || {}, req.webUser));
    } catch (error) {
        sendError(res, error, "POST /api/admin/processes/:env/commands");
    }
});

module.exports = router;
