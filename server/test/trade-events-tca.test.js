const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { arrivalSlippageBps, REASON_CODES } = require("../src/lib/trade-events");

describe("trade-events TCA helpers", () => {
    it("computes arrival slippage bps for buy", () => {
        const out = arrivalSlippageBps({ side: "BUY", fillVwap: 101, reference: 100 });
        assert.equal(out.quality, "fresh");
        assert.ok(Math.abs(out.bps - 100) < 1e-6);
    });

    it("returns missing when reference absent", () => {
        const out = arrivalSlippageBps({ side: "LONG", fillVwap: 10, reference: null });
        assert.equal(out.bps, null);
        assert.equal(out.quality, "missing");
    });

    it("keeps risk_rejected in reason catalog", () => {
        assert.ok(REASON_CODES.has("risk_rejected"));
        assert.ok(REASON_CODES.has("legacy_unresolved"));
    });
});
