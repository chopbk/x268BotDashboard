const express = require("express");
const mongoose = require("mongoose");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { PERMISSIONS } = require("../auth/access-control");
const { sendError, httpError } = require("../lib/http");
const { loadPositions, monitorDetail, monitorOwner, heartbeatFresh, visibleBots } = require("../lib/positions");
const { getPositionHub } = require("../lib/position-feed");
const UserAccount = require("../models/user-account");
const MonitorPosition = require("../models/monitor-position");
const ProcessHeartbeat = require("../models/process-heartbeat");

const router = express.Router();

router.get("/", requireAuth, requirePermission(PERMISSIONS.POSITIONS_VIEW), async (req, res) => {
    try {
        const account = String(req.query.account || "").trim();
        const hub = getPositionHub();
        if (account) {
            await loadPositions(req.webUser, { account }, { snapshot: async () => null });
            try {
                await hub.prime(account);
            } catch (error) {
                console.error("[GET /api/positions]", error.message);
            }
        }
        res.json(await loadPositions(req.webUser, req.query, {
            snapshot: (name) => hub.cached(name),
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
        const snap = getPositionHub().cached(owner);
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

router.get("/stream", requireAuth, requirePermission(PERMISSIONS.POSITIONS_VIEW), async (req, res) => {
    const account = String(req.query.account || "").trim();
    try {
        if (!account) throw httpError(400, "Chọn tài khoản");
        await loadPositions(req.webUser, { account }, { snapshot: async () => null });
    } catch (error) {
        sendError(res, error, "GET /api/positions/stream");
        return;
    }
    res.setTimeout(0);
    req.setTimeout(0);
    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
    });
    let closed = false;
    const write = (view) => {
        if (closed || res.writableEnded) return;
        res.write(`event: snapshot\ndata: ${JSON.stringify(view)}\n\n`);
    };
    const stop = getPositionHub().watch(account, async (snap) => {
        if (closed) return;
        try {
            write(await loadPositions(req.webUser, { account }, { snapshot: async () => snap }));
        } catch (error) {
            console.error("[GET /api/positions/stream]", error.message);
        }
    });
    const ping = setInterval(() => {
        if (!closed && !res.writableEnded) res.write(`: ping\n\n`);
    }, 15000);
    req.on("close", () => {
        closed = true;
        clearInterval(ping);
        stop();
    });
});

module.exports = router;
