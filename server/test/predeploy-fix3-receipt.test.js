const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const TradingReceipt = require("../src/models/trading-receipt");
const {
    RECEIPT_STATUSES,
    receiptStatusFromResult,
    assertReceiptStatus,
    isTerminalReceiptStatus,
} = require("../src/lib/trading-receipt-status");
const { publicTradingCommand } = require("../src/lib/trading-bridge");

describe("predeploy fix3 — receipt partial chain", () => {
    it("model enum accepts partial", () => {
        const doc = new TradingReceipt({
            requestId: "r1",
            idempotencyKey: "k1",
            action: "POSITION_REVERSE",
            status: "partial",
            actorUserId: "u1",
            expiresAt: new Date(Date.now() + 60_000),
            result: { partial: true, closeOk: true, openBlocked: true },
        });
        const err = doc.validateSync();
        assert.equal(err, undefined);
        assert.equal(doc.status, "partial");
    });

    it("model still rejects unknown enum values", () => {
        const doc = new TradingReceipt({
            requestId: "r2",
            idempotencyKey: "k2",
            action: "POSITION_REVERSE",
            status: "halfway",
            actorUserId: "u1",
            expiresAt: new Date(Date.now() + 60_000),
        });
        const err = doc.validateSync();
        assert.ok(err);
        assert.match(String(err.message), /partial|enum|halfway/i);
    });

    it("receiptStatusFromResult maps reverse closeOk → partial", () => {
        assert.equal(
            receiptStatusFromResult({
                success: false,
                partial: true,
                closeOk: true,
                openBlocked: true,
                gateError: true,
            }),
            "partial"
        );
        assert.equal(receiptStatusFromResult({ success: true }), "succeeded");
        assert.equal(receiptStatusFromResult({ success: false }), "failed");
        assert.equal(assertReceiptStatus("partial"), "partial");
        assert.ok(RECEIPT_STATUSES.includes("partial"));
        assert.equal(isTerminalReceiptStatus("partial"), true);
    });

    it("publicTradingCommand exposes partial as terminal", () => {
        const view = publicTradingCommand({
            requestId: "r3",
            action: "POSITION_REVERSE",
            status: "partial",
            result: { closeOk: true, openBlocked: true, partial: true },
            target: { username: "botA" },
        });
        assert.equal(view.status, "partial");
        assert.equal(view.terminal, true);
        assert.equal(view.result.closeOk, true);
    });
});
