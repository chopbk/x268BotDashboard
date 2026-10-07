const express = require("express");
const UserAccount = require("../models/user-account");
const { requireAuth, requirePermission, canAccessBot } = require("../middleware/auth");
const { PERMISSIONS, hasPermission } = require("../auth/access-control");
const { sendError } = require("../lib/http");
const { safeRecordAudit } = require("../lib/audit");
const {
    normalizeName,
    createBot,
    renameBot,
    deleteBot,
    addAccount,
    renameAccount,
    deleteAccount,
} = require("../lib/bot-directory");

const router = express.Router();

router.get("/", requireAuth, requirePermission(PERMISSIONS.BOTS_VIEW), async (req, res) => {
    try {
        const filter =
            hasPermission(req.webUser, PERMISSIONS.USERS_MANAGE)
                ? {}
                : { username: { $in: req.webUser.botUsernames } };
        const rows = await UserAccount.find(filter)
            .select("username accounts")
            .sort({ username: 1 })
            .lean();
        const bots = rows
            .filter((row) => canAccessBot(req.webUser, row.username))
            .map((row) => ({
                username: row.username,
                accounts: row.accounts || [],
            }));
        res.json({ bots });
    } catch (error) {
        sendError(res, error, "GET /api/bots");
    }
});

router.post("/", requireAuth, requirePermission(PERMISSIONS.USERS_MANAGE), async (req, res) => {
    try {
        const bot = await createBot(normalizeName(req.body?.username));
        await safeRecordAudit({ action: "bot.created", actor: req.webUser, targetType: "bot", target: bot, changes: { username: { from: null, to: bot.username } } });
        res.status(201).json({ bot });
    } catch (error) {
        sendError(res, error, "POST /api/bots");
    }
});

router.patch("/:username", requireAuth, requirePermission(PERMISSIONS.USERS_MANAGE), async (req, res) => {
    try {
        const previousName = normalizeName(req.params.username);
        const bot = await renameBot(
            req.webUser,
            previousName,
            normalizeName(req.body?.username)
        );
        if (previousName !== bot.username) await safeRecordAudit({ action: "bot.renamed", actor: req.webUser, targetType: "bot", target: bot, changes: { username: { from: previousName, to: bot.username } } });
        res.json({ bot });
    } catch (error) {
        sendError(res, error, "PATCH /api/bots/:username");
    }
});

router.delete("/:username", requireAuth, requirePermission(PERMISSIONS.USERS_MANAGE), async (req, res) => {
    try {
        const username = normalizeName(req.params.username);
        const result = await deleteBot(req.webUser, username);
        await safeRecordAudit({ action: "bot.deleted", actor: req.webUser, targetType: "bot", target: { username }, changes: { deleted: { from: false, to: true } } });
        res.json(result);
    } catch (error) {
        sendError(res, error, "DELETE /api/bots/:username");
    }
});

router.post(
    "/:username/accounts",
    requireAuth,
    requirePermission(PERMISSIONS.CONFIG_EDIT),
    async (req, res) => {
        try {
            const username = normalizeName(req.params.username);
            const env = normalizeName(req.body?.env);
            const bot = await addAccount(
                req.webUser,
                username,
                env
            );
            await safeRecordAudit({ action: "bot.account_added", actor: req.webUser, targetType: "bot", target: bot, changes: { account: { from: null, to: env } } });
            res.status(201).json({ bot });
        } catch (error) {
            sendError(res, error, "POST /api/bots/:username/accounts");
        }
    }
);

router.patch(
    "/:username/accounts/:env",
    requireAuth,
    requirePermission(PERMISSIONS.CONFIG_EDIT),
    async (req, res) => {
        try {
            const username = normalizeName(req.params.username);
            const env = normalizeName(req.params.env);
            const nextEnv = normalizeName(req.body?.env);
            const bot = await renameAccount(
                req.webUser,
                username,
                env,
                nextEnv
            );
            if (env !== nextEnv) await safeRecordAudit({ action: "bot.account_renamed", actor: req.webUser, targetType: "bot", target: bot, changes: { account: { from: env, to: nextEnv } } });
            res.json({ bot });
        } catch (error) {
            sendError(res, error, "PATCH /api/bots/:username/accounts/:env");
        }
    }
);

router.delete(
    "/:username/accounts/:env",
    requireAuth,
    requirePermission(PERMISSIONS.CONFIG_EDIT),
    async (req, res) => {
        try {
            const username = normalizeName(req.params.username);
            const env = normalizeName(req.params.env);
            const bot = await deleteAccount(
                req.webUser,
                username,
                env
            );
            await safeRecordAudit({ action: "bot.account_deleted", actor: req.webUser, targetType: "bot", target: bot, changes: { account: { from: env, to: null } } });
            res.json({ bot });
        } catch (error) {
            sendError(res, error, "DELETE /api/bots/:username/accounts/:env");
        }
    }
);

module.exports = router;
