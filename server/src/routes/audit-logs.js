const express = require("express");
const AuditLog = require("../models/audit-log");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { PERMISSIONS } = require("../auth/access-control");
const { sendError } = require("../lib/http");

const router = express.Router();

router.use(requireAuth, requirePermission(PERMISSIONS.LOGS_VIEW));

function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

router.get("/", async (req, res) => {
    try {
        const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
        const limit = Math.min(100, Math.max(10, Number.parseInt(req.query.limit, 10) || 50));
        const query = String(req.query.q || "").trim();
        const filter = {};
        if (query) {
            const pattern = new RegExp(escapeRegex(query), "i");
            filter.$or = [
                { action: pattern },
                { "actor.email": pattern },
                { "actor.username": pattern },
                { "actor.name": pattern },
                { "target.email": pattern },
                { "target.username": pattern },
                { "target.name": pattern },
            ];
        }

        const [logs, total] = await Promise.all([
            AuditLog.find(filter)
                .sort({ createdAt: -1, _id: -1 })
                .skip((page - 1) * limit)
                .limit(limit)
                .lean(),
            AuditLog.countDocuments(filter),
        ]);
        res.json({
            logs: logs.map((row) => ({
                id: String(row._id),
                action: row.action,
                actor: row.actor,
                targetType: row.targetType,
                target: row.target,
                changes: row.changes || {},
                createdAt: row.createdAt,
            })),
            page,
            limit,
            total,
        });
    } catch (error) {
        sendError(res, error, "GET /api/audit-logs");
    }
});

module.exports = router;
