const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { buildPortfolioSnapshot, buildShockScenarios } = require("../src/lib/risk-portfolio");

describe("risk-portfolio snapshot", () => {
    it("counts exchange book once and attributes own qty separately", () => {
        const snap = buildPortfolioSnapshot({
            username: "acc1",
            positions: [{
                symbol: "BTCUSDT",
                side: "LONG",
                qty: 2,
                mark: 100,
                entry: 90,
                exchangeSl: 80,
                monitors: [
                    { env: "A", ownQty: 1, signal: "SIG1" },
                    { env: "B", ownQty: 0.5, signal: "SIG2" },
                ],
            }],
            wallet: { equity: 1000, available: 500 },
            reservations: [{ status: "reserved", notionalNeed: 50 }],
            openOrders: [{ origQty: 1, price: 100, reduceOnly: false }],
        });
        assert.equal(snap.gross, 200);
        assert.equal(snap.net, 200);
        assert.equal(snap.attribution.length, 2);
        assert.equal(snap.reservedNotional, 50);
        assert.equal(snap.pendingEntryNotional, 100);
        assert.equal(snap.provenance.coverage.accountingBasis, "exchange_book_once");
        assert.equal(snap.provenance.coverage.attribution, "own_qty_only");
        assert.ok(snap.coveredRiskAtStop > 0);
    });

    it("marks daily loss incomplete without equity start / cashflows", () => {
        const snap = buildPortfolioSnapshot({
            username: "acc1",
            positions: [],
            wallet: { equity: 100 },
        });
        assert.equal(snap.dailyLoss, null);
        // Có equity nhưng thiếu start → missingFields; quality dailyLoss = missing
        assert.equal(snap.dailyLossQuality, "missing");
        assert.ok(snap.provenance.missingFields.includes("equityStartUtc"));
    });

    it("accepts account-balance-read shape (balance/available) without inventing uPnL equity", () => {
        const snap = buildPortfolioSnapshot({
            username: "acc1",
            positions: [],
            wallet: { balance: 250, available: 200, stale: false, source: "redis" },
        });
        assert.equal(snap.walletBalance, 250);
        assert.equal(snap.equity, 250);
        assert.equal(snap.equityBasis, "wallet_balance_only");
        assert.equal(snap.available, 200);
    });

    it("shock scenarios stay partial and do not invent liquidation odds", () => {
        const snap = buildPortfolioSnapshot({
            username: "a",
            positions: [{ symbol: "ETHUSDT", side: "LONG", qty: 1, mark: 10 }],
            wallet: { equity: 100 },
        });
        const out = buildShockScenarios(snap, { btcShocks: [0.05] });
        assert.equal(out.quality, "partial");
        assert.equal(out.scenarios.length, 2);
        assert.ok(out.scenarios.every((s) => s.assumption.includes("beta")));
    });
});
