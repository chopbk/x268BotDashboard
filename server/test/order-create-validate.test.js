const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { validateOrderCreate } = require("../src/lib/trading-bridge");

describe("validateOrderCreate", () => {
    it("accepts LIMIT buy", () => {
        const result = validateOrderCreate({
            side: "BUY",
            positionSide: "LONG",
            type: "LIMIT",
            quantity: "0.01",
            price: "65000",
        });
        assert.equal(result.valid, true);
        assert.equal(result.normalized.kind, "regular");
        assert.equal(result.normalized.type, "LIMIT");
    });

    it("routes STOP_MARKET to algo kind", () => {
        const result = validateOrderCreate({
            side: "SELL",
            positionSide: "LONG",
            type: "STOP_MARKET",
            quantity: "1",
            triggerPrice: "60000",
        });
        assert.equal(result.valid, true);
        assert.equal(result.normalized.kind, "algo");
        assert.equal(result.normalized.triggerPrice, "60000");
    });

    it("rejects LIMIT without price", () => {
        const result = validateOrderCreate({
            side: "BUY",
            positionSide: "LONG",
            type: "LIMIT",
            quantity: "1",
        });
        assert.equal(result.valid, false);
    });

    it("rejects trailing without callbackRate", () => {
        const result = validateOrderCreate({
            side: "SELL",
            positionSide: "LONG",
            type: "TRAILING_STOP_MARKET",
            quantity: "1",
        });
        assert.equal(result.valid, false);
    });
});
