const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
    finite,
    deltaQty,
    deltaPct,
    deltaRatioPoints,
    profitRatioPct,
    distanceToEntryPct,
    fundingCostEstimate,
    biasFromLongShort,
} = require("../src/lib/smart-money/formulas");
const { buildSnapshot } = require("../src/lib/smart-money/normalize");
const { parseOverview } = require("../src/lib/smart-money/adapters/smart-money-bapi");
const { scoreSnapshot, gate } = require("../src/lib/smart-money/candidates");

describe("smart-money formulas null-safety", () => {
    it("does not coerce missing to 0", () => {
        assert.equal(finite(null), null);
        assert.equal(finite(undefined), null);
        assert.equal(finite(""), null);
        assert.equal(finite("x"), null);
        assert.equal(deltaQty(10, null), null);
        assert.equal(deltaPct(10, 0), null);
        assert.equal(deltaPct(12, 10), 20);
        assert.equal(profitRatioPct(5, 0), null);
        assert.equal(profitRatioPct(null, 10), null);
    });

    it("price up with unchanged qty is not position increase", () => {
        assert.equal(deltaQty(100, 100), 0);
        assert.equal(deltaPct(100, 100), 0);
    });

    it("distance to entry is not ROE", () => {
        assert.equal(distanceToEntryPct(110, 100, "LONG"), 10);
        assert.equal(distanceToEntryPct(110, 100, "SHORT"), -10);
        assert.equal(distanceToEntryPct(110, 100, null), 10);
        assert.equal(distanceToEntryPct(110, null, "LONG"), null);
    });

    it("funding estimate states assumptions", () => {
        const est = fundingCostEstimate(0.0001, 10_000, 8, "LONG");
        assert.ok(est);
        assert.equal(est.longPays, true);
        assert.ok(est.assumption.includes("8h"));
        assert.equal(fundingCostEstimate(null, 10_000, 8), null);
    });

    it("bias handles one-sided and empty", () => {
        assert.equal(biasFromLongShort(10, null), "long");
        assert.equal(biasFromLongShort(null, 10), "short");
        assert.equal(biasFromLongShort(null, null), "unclear");
        assert.equal(biasFromLongShort(0, 0), "unclear");
    });

    it("delta ratio uses percentage points", () => {
        assert.equal(deltaRatioPoints(80, 50), 30);
        assert.equal(deltaRatioPoints(null, 50), null);
    });
});

describe("smart-money parse and cohort", () => {
    it("parseOverview keeps nulls instead of zeros for missing fields", () => {
        const parsed = parseOverview({
            updateTime: 1700000000000,
            longTraders: "3",
            longTradersQty: "1.5",
            longTradersAvgEntryPrice: "100",
        });
        assert.equal(parsed.traders.shortCount, null);
        assert.equal(parsed.traders.shortQty, null);
        assert.equal(parsed.whales.longQty, null);
        assert.equal(parsed.cohortId, "sd:1700000000000");
    });

    it("cohort change marks deltas non-comparable", () => {
        const previous = buildSnapshot({
            symbol: "ETHUSDT",
            smartMoney: {
                ok: true,
                data: {
                    cohortId: "sd:1",
                    signalDay: 1,
                    traders: { longQty: 10, shortQty: 5 },
                    whales: {},
                },
            },
            price: { lastPrice: 100, priceChangePercent: 1, quoteVolume: 1e6 },
        });
        const next = buildSnapshot({
            symbol: "ETHUSDT",
            previous,
            smartMoney: {
                ok: true,
                data: {
                    cohortId: "sd:2",
                    signalDay: 2,
                    traders: { longQty: 20, shortQty: 5 },
                    whales: {},
                },
            },
            price: { lastPrice: 110, priceChangePercent: 2, quoteVolume: 1e6 },
        });
        assert.equal(next.smartMoney.comparable, false);
        assert.equal(next.derived.deltas.tradersLongQty, null);
        assert.equal(next.derived.deltas.cohortReset, true);
    });
});

describe("smart-money candidates gate", () => {
    it("rejects low coverage and does not inflate score", () => {
        const thin = buildSnapshot({
            symbol: "AAAUSDT",
            price: { lastPrice: 1, priceChangePercent: 1, quoteVolume: 1 },
        });
        assert.equal(gate(thin).ok, false);
        assert.equal(scoreSnapshot(thin), null);
    });

    it("scores only when enough sources", () => {
        const snap = buildSnapshot({
            symbol: "BTCUSDT",
            price: { lastPrice: 50000, priceChangePercent: 2, quoteVolume: 1e9 },
            oi: { ok: true, data: { qty: 100, notional: 1e6, prevQty: 90, prevNotional: 9e5 } },
            funding: { ok: true, data: { currentRate: 0.0001, intervalHours: 8 } },
            topTrader: {
                ok: true,
                data: {
                    period: "1h",
                    accountLsr: 1.1,
                    positionLsr: 1.2,
                    takerBuySellRatio: 1.3,
                    periodEnd: new Date().toISOString(),
                },
            },
            smartMoney: {
                ok: true,
                data: {
                    cohortId: "sd:1",
                    signalDay: 1,
                    traders: { longQty: 200, shortQty: 80, longCount: 10, shortCount: 4 },
                    whales: { longQty: 50, shortQty: 20, longCount: 2, shortCount: 1 },
                },
            },
        });
        const scored = scoreSnapshot(snap);
        assert.ok(scored);
        assert.equal(scored.lean, "long");
        assert.ok(scored.coverage.okCount >= 3);
        assert.ok(scored.note.includes("không phải xác suất"));
    });
});
