const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
    classifyClaimReplay,
    buildTradingPayloadHash,
    isInFlightStatus,
} = require("../src/lib/trading-receipt-claim");
const { RECEIPT_STATUSES } = require("../src/lib/trading-receipt-status");

describe("predeploy fix5 — claim before execute", () => {
    it("same key + different payloadHash → conflict", () => {
        const out = classifyClaimReplay(
            { payloadHash: "aaa", action: "POSITION_OPEN" },
            { payloadHash: "bbb", action: "POSITION_OPEN" }
        );
        assert.equal(out.kind, "conflict");
        assert.match(out.message, /khác payload/);
    });

    it("same key + same payloadHash → replay (no second execute)", () => {
        const out = classifyClaimReplay(
            { payloadHash: "aaa", action: "POSITION_OPEN", status: "succeeded" },
            { payloadHash: "aaa", action: "POSITION_OPEN" }
        );
        assert.equal(out.kind, "replay");
    });

    it("legacy receipt without hash: different action → conflict", () => {
        const out = classifyClaimReplay(
            { action: "POSITION_CLOSE" },
            { payloadHash: "x", action: "POSITION_OPEN" }
        );
        assert.equal(out.kind, "conflict");
    });

    it("payload hash ổn định theo action/target/params", () => {
        const a = buildTradingPayloadHash({
            action: "POSITION_OPEN",
            target: { username: "u", symbol: "btcusdt", positionSide: "LONG" },
            params: { quantity: "1" },
        });
        const b = buildTradingPayloadHash({
            action: "POSITION_OPEN",
            target: { username: "u", symbol: "BTCUSDT", positionSide: "LONG" },
            params: { quantity: "1" },
        });
        const c = buildTradingPayloadHash({
            action: "POSITION_OPEN",
            target: { username: "u", symbol: "BTCUSDT", positionSide: "LONG" },
            params: { quantity: "2" },
        });
        assert.equal(a, b);
        assert.notEqual(a, c);
    });

    it("claimed/submitted are in-flight; partial is terminal-ish for replay UI", () => {
        assert.equal(isInFlightStatus("claimed"), true);
        assert.equal(isInFlightStatus("submitted"), true);
        assert.equal(isInFlightStatus("partial"), false);
        assert.equal(isInFlightStatus("succeeded"), false);
        assert.ok(RECEIPT_STATUSES.includes("claimed"));
    });
});
