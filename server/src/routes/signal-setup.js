const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { PERMISSIONS, hasPermission } = require("../auth/access-control");
const { sendError } = require("../lib/http");
const { buildChanges, safeRecordAudit } = require("../lib/audit");
const { AUDIT_FIELDS } = require("../lib/account-config-view");
const { normalizeName } = require("../lib/bot-directory");
const { listSignalSetup, applySignals } = require("../lib/signal-setup");

const router = express.Router();

function requireSignalPage(req, res, next) {
    if (!hasPermission(req.webUser, PERMISSIONS.CONFIG_VIEW) && !hasPermission(req.webUser, PERMISSIONS.SIGNALS_HISTORY)) {
        return res.status(403).json({ error: "Không có quyền" });
    }
    next();
}

router.get("/", requireAuth, requireSignalPage, async (req, res) => {
    try {
        res.json(await listSignalSetup(req.webUser, req.query));
    } catch (error) {
        sendError(res, error, "GET /api/signal-config");
    }
});

router.post("/", requireAuth, requirePermission(PERMISSIONS.CONFIG_EDIT), async (req, res) => {
    try {
        const username = normalizeName(req.body?.username);
        const result = await applySignals(req.webUser, username, req.body);
        for (const row of result.updated) {
            if (!row.changed) continue;
            const changes = buildChanges(row.before, row.after, AUDIT_FIELDS);
            if (!Object.keys(changes).length) continue;
            await safeRecordAudit({
                action: "config.updated",
                actor: req.webUser,
                targetType: "account_config",
                target: { username: `${username}/${row.env}` },
                changes,
            });
        }
        res.json({
            action: result.action,
            updated: result.updated.map((row) => ({ env: row.env, changed: row.changed, signals: row.signals })),
            failed: result.failed,
        });
    } catch (error) {
        sendError(res, error, "POST /api/signal-config");
    }
});

module.exports = router;
