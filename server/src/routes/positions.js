const express = require("express");
const mongoose = require("mongoose");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { PERMISSIONS } = require("../auth/access-control");
const { sendError, httpError } = require("../lib/http");
const { loadPositions, monitorDetail, monitorOwner, heartbeatFresh, visibleBots } = require("../lib/positions");
const { refresh, cached } = require("../lib/position-live");
const UserAccount = require("../models/user-account");
const MonitorPosition = require("../models/monitor-position");
const ProcessHeartbeat = require("../models/process-heartbeat");

const router = express.Router();

router.get("/", requireAuth, requirePermission(PERMISSIONS.POSITIONS_VIEW), async (req, res) => {
    try {
        const account = String(req.query.account || "").trim();
        if (account) {
            await loadPositions(req.webUser, { account }, { snapshot: async () => null });
            try {
                await refresh(account);
            } catch (error) {
                console.error("[GET /api/positions]", error.message);
            }
        }
        res.json(await loadPositions(req.webUser, req.query, {
            snapshot: (name) => cached(name),
        }));
    } catch (error) {
        sendError(res, error, "GET /api/positions");
    }
});

router.get("/detail", requireAuth, requirePermission(PERMISSIONS.POSITIONS_VIEW), async (req, res) => {
    try {
        const id = String(req.query.id || "");
        if (!mongoose.Types.ObjectId.isValid(id)) throw httpError(404, "Không tìm thấy monitor");
        const bots = await visibleBots(req.webUser, UserAccount);
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
