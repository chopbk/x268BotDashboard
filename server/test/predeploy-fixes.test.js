const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { walkForwardStub } = require("../src/lib/quant/stub-engine");
const { publicAlgo } = require("../src/lib/trading/algo-orders");
const { enforceReady } = require("../src/lib/risk-policy");
const { isIncreaseAction } = require("../src/lib/risk-gate");

describe("pre-deploy fixes", () => {
    it("walk-forward rejects testBars=0 instead of hanging", () => {
        const bars = Array.from({ length: 100 }, (_, i) => ({
            t: i, open: 1, high: 1, low: 1, close: 1, availableAt: i, closeTime: i, openTime: i,
        }));
        const out = walkForwardStub({ bars }, { trainBars: 10, testBars: 0, purge: 1 });
        assert.equal(out.folds.length, 0);
        assert.equal(out.error, "invalid_train_or_test_bars");
    });

    it("walk-forward caps folds", () => {
        const bars = Array.from({ length: 500 }, (_, i) => ({
            t: i, open: 1, high: 1.1, low: 0.9, close: i % 2 ? 1.05 : 0.95,
            availableAt: i, closeTime: i, openTime: i,
        }));
        const out = walkForwardStub({ bars }, { trainBars: 20, testBars: 5, purge: 1, maxFolds: 3 });
        assert.ok(out.folds.length <= 3);
        assert.equal(out.truncated, true);
    });

    it("algo outstanding subtracts child filledQty", () => {
        const view = publicAlgo({
            algoId: "a",
            account: "u",
            symbol: "BTCUSDT",
            type: "TWAP",
            parentQuantity: 10,
            filledQty: 4,
            children: [
                { childId: "1", status: "submitted", quantity: 5, filledQty: 4 },
                { childId: "2", status: "pending", quantity: 5, filledQty: 0 },
            ],
            liveExecution: false,
        });
        // outstanding = (5-4) + 5 = 6; filled+outstanding = 4+6 = 10
        assert.equal(view.outstandingQty, 6);
        assert.equal(view.invariant.fillsPlusOutstandingLteParent, true);
    });

    it("enforce locked without RISK_ENFORCE_READY", () => {
        const prev = process.env.RISK_ENFORCE_READY;
        delete process.env.RISK_ENFORCE_READY;
        assert.equal(enforceReady(), false);
        process.env.RISK_ENFORCE_READY = "true";
        assert.equal(enforceReady(), true);
        if (prev == null) delete process.env.RISK_ENFORCE_READY;
        else process.env.RISK_ENFORCE_READY = prev;
    });

    it("reverse close_leg bypasses increase gate", () => {
        assert.equal(isIncreaseAction("POSITION_REVERSE", { phase: "close_leg" }), false);
        assert.equal(isIncreaseAction("POSITION_REVERSE", { phase: "open_leg" }), true);
    });
});
