const express = require("express");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { PERMISSIONS } = require("../auth/access-control");
const { sendError } = require("../lib/http");
const { buildChanges, safeRecordAudit } = require("../lib/audit");
const { normalizeName } = require("../lib/bot-directory");
const {
    EXCHANGES,
    listUserApis,
    getUserApi,
    createUserApi,
    updateUserApi,
    deleteUserApi,
} = require("../lib/user-api-directory");

const router = express.Router();
const PUBLIC_FIELDS = [
    "username",
    "exchange",
    "hedgeMode",
    "test",
    "subAccount",
    "hasApiKey",
    "hasApiSecret",
    "hasPassword",
];

function auditTarget(username) {
    return { username };
}

router.get("/", requireAuth, requirePermission(PERMISSIONS.CREDENTIALS_VIEW), async (req, res) => {
    try {
        const apis = await listUserApis(req.webUser);
        res.json({ apis, exchanges: EXCHANGES });
    } catch (error) {
        sendError(res, error, "GET /api/user-apis");
    }
});

router.post("/", requireAuth, requirePermission(PERMISSIONS.CREDENTIALS_MANAGE), async (req, res) => {
    try {
        const api = await createUserApi(req.webUser, req.body);
        await safeRecordAudit({
            action: "credential.created",
            actor: req.webUser,
            targetType: "user_api",
            target: auditTarget(api.username),
            changes: buildChanges({}, api, PUBLIC_FIELDS),
        });
        res.status(201).json({ api });
    } catch (error) {
        sendError(res, error, "POST /api/user-apis");
    }
});

router.get(
    "/:username",
    requireAuth,
    requirePermission(PERMISSIONS.CREDENTIALS_VIEW),
    async (req, res) => {
        try {
            const api = await getUserApi(req.webUser, normalizeName(req.params.username));
            res.json({ api, exchanges: EXCHANGES });
        } catch (error) {
            sendError(res, error, "GET /api/user-apis/:username");
        }
    }
);

router.patch(
    "/:username",
    requireAuth,
    requirePermission(PERMISSIONS.CREDENTIALS_MANAGE),
    async (req, res) => {
        try {
            const username = normalizeName(req.params.username);
            const before = await getUserApi(req.webUser, username);
            const api = await updateUserApi(req.webUser, username, req.body);
            const changes = buildChanges(before, api, PUBLIC_FIELDS);
            if (Object.keys(changes).length) {
                await safeRecordAudit({
                    action: "credential.updated",
                    actor: req.webUser,
                    targetType: "user_api",
                    target: auditTarget(api.username),
                    changes,
                });
            }
            res.json({ api });
        } catch (error) {
            sendError(res, error, "PATCH /api/user-apis/:username");
        }
    }
);

router.delete(
    "/:username",
    requireAuth,
    requirePermission(PERMISSIONS.CREDENTIALS_MANAGE),
    async (req, res) => {
        try {
            const username = normalizeName(req.params.username);
            const result = await deleteUserApi(req.webUser, username);
            await safeRecordAudit({
                action: "credential.deleted",
                actor: req.webUser,
                targetType: "user_api",
                target: auditTarget(username),
                changes: { deleted: { from: false, to: true } },
            });
            res.json(result);
        } catch (error) {
            sendError(res, error, "DELETE /api/user-apis/:username");
        }
    }
);

module.exports = router;
