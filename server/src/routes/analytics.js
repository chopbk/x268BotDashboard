const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { PERMISSIONS, hasPermission } = require("../auth/access-control");
const { sendError, httpError } = require("../lib/http");
const { publicCatalog } = require("../lib/analytics/metric-definitions");
const {
    computeStrategyMetrics,
    computeBreakdown,
    ACCOUNTING_BASES,
} = require("../lib/analytics/strategy-metrics");
const { buildPerformanceAlerts } = require("../lib/analytics/performance-alerts");
const { arrivalSlippageBps } = require("../lib/trade-events");

const router = express.Router();

function requireStats(req, res, next) {
    if (!hasPermission(req.webUser, PERMISSIONS.STATISTICS_VIEW)) {
        return res.status(403).json({ error: "Không có quyền" });
    }
    return next();
}

router.get("/definitions", requireAuth, requireStats, (_req, res) => {
    res.json(publicCatalog());
});

/**
 * GET /api/analytics/strategies
 * Body/query: trades JSON optional for offline; hoặc username → load statics (lazy).
 * Không tạo dashboard PnL định nghĩa khác — reuse metric module.
 */
router.get("/strategies", requireAuth, requireStats, async (req, res) => {
    try {
        const username = String(req.query.username || "").trim();
        if (!username) throw httpError(400, "Thiếu username");

        let trades = [];
        let sourceStatus = "ok";
        let sourceError = null;
        let truncated = false;
        const ANALYTICS_CAP = Math.min(5000, Math.max(100, Number(req.query.cap) || 2000));

        try {
            const { listAccountStatics } = require("../lib/account-statics");
            // Lấy metadata phạm vi (envs/filter) qua list, rồi query đủ tập (không dùng 1 trang 50 làm toàn bộ).
            const meta = await listAccountStatics(req.webUser, {
                username,
                closed: req.query.closed || "closed",
                book: req.query.book || "live",
                range: req.query.range || "30",
                page: 1,
                limit: 10,
                analytics: "1",
            });
            const envs = meta?.envs || [];
            if (!envs.length) {
                sourceStatus = "empty_scope";
            } else {
                const AccountStatic = require("../models/account-static");
                const total = Number(meta.listTotal ?? meta.total ?? 0);
                truncated = total > ANALYTICS_CAP;
                const filter = {
                    env: { $in: envs },
                    ...(meta.book === "paper"
                        ? { isPaper: true }
                        : meta.book === "all"
                            ? {}
                            : { isPaper: { $ne: true } }),
                };
                if (meta.from || meta.to) {
                    filter.closeTime = {};
                    if (meta.from) filter.closeTime.$gte = new Date(meta.from);
                    if (meta.to) filter.closeTime.$lte = new Date(meta.to);
                }
                trades = await AccountStatic.find(filter)
                    .select("profit fees funding commission entryPrice symbol side positionSide typeSignal env closeTime openTime initialPlannedRisk dcaCount maxRoe minRoe maxPrice minPrice stats pnlIncludesFees isPaper")
                    .sort({ closeTime: 1, _id: 1 })
                    .limit(ANALYTICS_CAP)
                    .lean();
                if (!trades.length && total === 0) sourceStatus = "no_trades";
            }
        } catch (err) {
            sourceStatus = "load_failed";
            sourceError = err.message || "load_failed";
            trades = [];
        }

        if (sourceStatus === "load_failed") {
            return res.status(502).json({
                error: "Không tải được account_statics",
                sourceStatus,
                sourceError,
                username,
            });
        }

        const summary = computeStrategyMetrics(trades, {
            accountingBasis: req.query.basis === "wallet"
                ? ACCOUNTING_BASES.WALLET_TRADING_NET
                : ACCOUNTING_BASES.OBSERVED_STATIC_PROFIT,
            minSample: Number(req.query.minSample) || 20,
            includeCatalog: true,
            startingEquity: req.query.startingEquity != null
                ? Number(req.query.startingEquity)
                : undefined,
        });
        const breakdown = computeBreakdown(trades, {
            accountingBasis: summary.accountingBasis,
            minSample: Number(req.query.minSample) || 20,
        });
        const alerts = buildPerformanceAlerts(summary, {
            minSample: Number(req.query.minSample) || 20,
        });
        res.json({
            username,
            tradeCount: trades.length,
            sourceStatus,
            truncated,
            cap: ANALYTICS_CAP,
            summary,
            breakdown,
            alerts,
        });
    } catch (error) {
        sendError(res, error, "GET /api/analytics/strategies");
    }
});

/** Offline/fixture compute — không ghi DB, không đụng config. */
router.post("/strategies/compute", requireAuth, requireStats, (req, res) => {
    try {
        const trades = Array.isArray(req.body?.trades) ? req.body.trades : [];
        const summary = computeStrategyMetrics(trades, {
            accountingBasis: req.body?.accountingBasis || ACCOUNTING_BASES.OBSERVED_STATIC_PROFIT,
            minSample: Number(req.body?.minSample) || 20,
            cashflows: req.body?.cashflows || null,
            startingEquity: req.body?.startingEquity,
            includeCatalog: true,
            riskFreePerPeriod: Number(req.body?.riskFreePerPeriod) || 0,
            periodsPerYear: Number(req.body?.periodsPerYear) || 365,
        });
        res.json({
            summary,
            breakdown: computeBreakdown(trades, { minSample: Number(req.body?.minSample) || 20 }),
            alerts: buildPerformanceAlerts(summary, { minSample: Number(req.body?.minSample) || 20 }),
        });
    } catch (error) {
        sendError(res, error, "POST /api/analytics/strategies/compute");
    }
});

router.get("/execution", requireAuth, requireStats, (req, res) => {
    try {
        // TCA helpers — không bịa fills
        const fills = Array.isArray(req.query.demo) ? [] : [];
        res.json({
            fills,
            note: "Cung cấp fills qua POST /execution/compute; không fabricate history",
            helpers: { arrivalSlippageBps: typeof arrivalSlippageBps === "function" },
        });
    } catch (error) {
        sendError(res, error, "GET /api/analytics/execution");
    }
});

router.post("/execution/compute", requireAuth, requireStats, (req, res) => {
    try {
        const fills = Array.isArray(req.body?.fills) ? req.body.fills : [];
        const rows = fills.map((f) => ({
            ...f,
            slippage: arrivalSlippageBps({
                side: f.side,
                fillVwap: f.fillVwap ?? f.price,
                reference: f.reference ?? f.arrivalPrice ?? f.signalPrice,
            }),
            latencyMs: f.latencyMs != null ? Number(f.latencyMs) : null,
            clockUncertainty: Boolean(f.clockUncertainty)
                || (typeof f.latencyMs === "number" && f.latencyMs < 0),
        }));
        res.json({ rows, quality: rows.length ? "fresh" : "missing" });
    } catch (error) {
        sendError(res, error, "POST /api/analytics/execution/compute");
    }
});

router.post("/alerts/evaluate", requireAuth, requireStats, (req, res) => {
    try {
        const summary = req.body?.summary || computeStrategyMetrics(req.body?.trades || []);
        const result = buildPerformanceAlerts(summary, {
            minSample: Number(req.body?.minSample) || 20,
        });
        if (result.autoDisable || result.mutatesConfig) {
            throw httpError(500, "Invariant broken: alerts must not mutate config");
        }
        res.json(result);
    } catch (error) {
        sendError(res, error, "POST /api/analytics/alerts/evaluate");
    }
});

module.exports = router;
