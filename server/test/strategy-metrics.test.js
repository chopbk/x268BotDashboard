const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
    computeStrategyMetrics,
    riskAdjustedReturns,
    resolveTradeNet,
    ACCOUNTING_BASES,
} = require("../src/lib/analytics/strategy-metrics");
const { buildPerformanceAlerts } = require("../src/lib/analytics/performance-alerts");
const { publicCatalog } = require("../src/lib/analytics/metric-definitions");

describe("P4 strategy metrics", () => {
    it("catalog is versioned", () => {
        const c = publicCatalog();
        assert.match(c.version, /quant\.metrics/);
        assert.equal(c.rankingDefaults.sortWinRateAloneIsNotEdge, true);
    });

    it("handles zero trades without NaN", () => {
        const s = computeStrategyMetrics([]);
        assert.equal(s.metrics.netPnL, null);
        assert.equal(s.metrics.profitFactor, null);
        assert.equal(s.quality, "missing");
        assert.equal(s.sample.edgeClaimAllowed, false);
    });

    it("all winners → PF undefined with label", () => {
        const s = computeStrategyMetrics([
            { profit: 1, closeTime: "2024-01-01" },
            { profit: 2, closeTime: "2024-01-02" },
        ], { minSample: 2 });
        assert.equal(s.metrics.profitFactor, null);
        assert.equal(s.metrics.profitFactorLabel, "Không có lệnh lỗ");
        assert.equal(s.sample.edgeClaimAllowed, false);
    });

    it("all losers → PF null, negative expectancy", () => {
        const s = computeStrategyMetrics([
            { profit: -1, closeTime: "2024-01-01" },
            { profit: -2, closeTime: "2024-01-02" },
        ], { minSample: 2 });
        assert.equal(s.metrics.profitFactor, null);
        assert.ok(s.metrics.expectancy < 0);
    });

    it("does not double-subtract fees when profit already net", () => {
        const a = resolveTradeNet(
            { profit: 10, fees: 1, funding: -0.5, pnlIncludesFees: true },
            { accountingBasis: ACCOUNTING_BASES.WALLET_TRADING_NET }
        );
        assert.equal(a.net, 10);
    });

    it("equity<=0 blocks sharpe", () => {
        const r = riskAdjustedReturns([
            { t: "a", equity: 100 },
            { t: "b", equity: 0 },
        ]);
        assert.equal(r.sharpe, null);
        assert.equal(r.quality, "incomplete");
    });

    it("R unknown without initial risk", () => {
        const s = computeStrategyMetrics([{ profit: 5, closeTime: "2024-01-01" }]);
        assert.equal(s.metrics.expectancyR, null);
        assert.equal(s.metrics.rCoverage.unknown, 1);
    });

    it("alerts never auto-disable config", () => {
        const s = computeStrategyMetrics(
            Array.from({ length: 25 }, (_, i) => ({
                profit: i % 2 === 0 ? 1 : -2,
                closeTime: `2024-01-${String((i % 28) + 1).padStart(2, "0")}`,
            })),
            { minSample: 20 }
        );
        const alerts = buildPerformanceAlerts(s, { minSample: 20 });
        assert.equal(alerts.autoDisable, false);
        assert.equal(alerts.mutatesConfig, false);
        assert.ok(alerts.alerts.some((a) => a.id === "pf_below_1" || a.id === "negative_expectancy"));
    });

    it("MAE/MFE incomplete on DCA", () => {
        const s = computeStrategyMetrics([{
            profit: 1,
            closeTime: "2024-01-01",
            entryPrice: 100,
            minPrice: 90,
            maxPrice: 110,
            side: "LONG",
            dcaCount: 2,
        }]);
        assert.ok(s.metrics.excursionFidelity.incompleteCount >= 1);
    });
});
