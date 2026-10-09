const express = require("express");
const mongoose = require("mongoose");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { createRateLimit } = require("../middleware/rate-limit");
const { PERMISSIONS } = require("../auth/access-control");
const { sendError, httpError } = require("../lib/http");
const { loadPositions, monitorDetail, monitorOwner, heartbeatFresh, visibleBots } = require("../lib/positions");
const { cached, readExchangeBook, readExchangeBooks, saveExchangeBook } = require("../lib/position-live");
const refreshLimit = createRateLimit({ windowMs: 15 * 60 * 1000, max: 6, prefix: "positions" });
const { loadExchangeBook } = require("../lib/position-feed");
const { markOf } = require("../lib/mark-prices");
const UserAccount = require("../models/user-account");
const MonitorPosition = require("../models/monitor-position");
const ProcessHeartbeat = require("../models/process-heartbeat");

const router = express.Router();

router.get("/", requireAuth, requirePermission(PERMISSIONS.POSITIONS_VIEW), async (req, res) => {
    try {
        const account = String(req.query.account || "").trim();
        if (account) await loadPositions(req.webUser, { account }, { snapshot: async () => null });
        res.json(await loadPositions(req.webUser, req.query, {
            snapshot: readExchangeBook,
            snapshots: readExchangeBooks,
            exchange: (name) => loadExchangeBook(name, { force: req.query.refresh === "1" }),
            saveExchange: saveExchangeBook,
            priceOf: markOf,
        }));
    } catch (error) {
        sendError(res, error, "GET /api/positions");
    }
});

router.post("/refresh", requireAuth, requirePermission(PERMISSIONS.POSITIONS_VIEW), refreshLimit, async (req, res) => {
    try {
        const account = String(req.body?.account || "").trim();
        const query = {
            account,
            audience: req.body?.audience,
            book: req.body?.book || "",
            refresh: "1",
        };
        if (account) await loadPositions(req.webUser, { account }, { snapshot: async () => null });
        res.json(await loadPositions(req.webUser, query, {
            snapshot: readExchangeBook,
            snapshots: readExchangeBooks,
            exchange: (name) => loadExchangeBook(name, { force: true }),
            saveExchange: saveExchangeBook,
            priceOf: markOf,
        }));
    } catch (error) {
        sendError(res, error, "POST /api/positions/refresh");
    }
});

router.get("/detail", requireAuth, requirePermission(PERMISSIONS.POSITIONS_VIEW), async (req, res) => {
    try {
        const id = String(req.query.id || "");
        if (!mongoose.Types.ObjectId.isValid(id)) throw httpError(404, "Không tìm thấy monitor");
        const audience = req.query.audience === "all" ? "all" : "mine";
        const bots = await visibleBots(req.webUser, UserAccount, audience);
        const envOwners = new Map();
        for (const bot of bots) {
            for (const env of bot.accounts || []) envOwners.set(env, bot.username);
        }
        const doc = await MonitorPosition.findById(id).lean();
        if (!doc) throw httpError(404, "Không tìm thấy monitor");
        const owner = monitorOwner(doc, envOwners);
        if (!bots.some((bot) => bot.username === owner)) throw httpError(403, "Không có quyền với tài khoản này");
        const beats = await ProcessHeartbeat.find({ "flags.monitor": true }).select("at flags").lean();
        const now = Date.now();
        const snap = cached(owner);
        const symbol = String(doc.symbol || "").toUpperCase();
        res.json({
            monitor: monitorDetail(doc, heartbeatFresh(beats, now), now),
            exchangeOrders: (snap?.openOrders || []).filter((row) => String(row.symbol || "").toUpperCase() === symbol),
            algoOrders: (snap?.algoOrders || []).filter((row) => String(row.symbol || "").toUpperCase() === symbol),
            connection: snap?.status || "idle",
            updatedAt: snap?.at || null,
            stale: snap?.stale === true,
        });
    } catch (error) {
        sendError(res, error, "GET /api/positions/detail");
    }
});

module.exports = router;
