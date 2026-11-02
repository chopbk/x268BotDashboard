const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
    decideCommitUnderFence,
    simulateTwoWorkerFenceRace,
} = require("../src/lib/risk-lock-commit");
const {
    isStaleInFlight,
    recoveryStatusOf,
    receiptExpiresAtForStatus,
    CLAIM_STALE_MS,
    RECOVERY_TTL_MS,
    TERMINAL_TTL_MS,
} = require("../src/lib/trading-receipt-claim");

describe("predeploy fix6 — atomic fence commit protocol", () => {
    it("pre-fence fail: no write orphan; enforce rejects", () => {
        const d = decideCommitUnderFence({
            preOk: false,
            postOk: false,
            mode: "enforce",
            reservationId: null,
        });
        assert.equal(d.commitOk, false);
        assert.equal(d.allowed, false);
        assert.equal(d.orphan, false);
        assert.equal(d.reason, "lock_fenced_before_write");
    });

    it("post-fence fail after write: orphan + enforce reject", () => {
        const d = decideCommitUnderFence({
            preOk: true,
            postOk: false,
            mode: "enforce",
            reservationId: "res-1",
        });
        assert.equal(d.commitOk, false);
        assert.equal(d.allowed, false);
        assert.equal(d.orphan, true);
        assert.equal(d.reason, "lock_fenced_after_write");
        assert.equal(d.reservationId, "res-1");
    });

    it("post-fence fail in observe: orphan but allow continue", () => {
        const d = decideCommitUnderFence({
            preOk: true,
            postOk: false,
            mode: "observe",
            reservationId: "res-2",
        });
        assert.equal(d.allowed, true);
        assert.equal(d.orphan, true);
    });

    it("two-worker race: 1 write then fence lost → enforce allowed false + orphan", () => {
        const sim = simulateTwoWorkerFenceRace({ mode: "enforce" });
        assert.equal(sim.writes, 1);
        assert.equal(sim.orphaned, true);
        assert.equal(sim.result.allowed, false);
        assert.equal(sim.result.reason, "lock_fenced_after_write");
        assert.equal(sim.result.reservationId, "res-sim-1");
    });
});

describe("predeploy fix6 — stale receipt recovery", () => {
    it("claimed younger than stale window is in_flight", () => {
        const doc = {
            status: "claimed",
            claimedAt: new Date(Date.now() - 1_000),
        };
        assert.equal(isStaleInFlight(doc), false);
        assert.equal(recoveryStatusOf(doc), "in_flight");
    });

    it("claimed older than stale window → stale_in_flight", () => {
        const doc = {
            status: "claimed",
            claimedAt: new Date(Date.now() - CLAIM_STALE_MS - 1_000),
        };
        assert.equal(isStaleInFlight(doc), true);
        assert.equal(recoveryStatusOf(doc), "stale_in_flight");
    });

    it("unknown recovery status needs_reconcile", () => {
        assert.equal(recoveryStatusOf({ status: "unknown" }), "needs_reconcile");
        assert.equal(recoveryStatusOf({ status: "succeeded" }), "complete");
    });

    it("unresolved TTL longer than terminal TTL", () => {
        const now = Date.now();
        const unk = receiptExpiresAtForStatus("unknown", now).getTime();
        const ok = receiptExpiresAtForStatus("succeeded", now).getTime();
        assert.equal(unk - now, RECOVERY_TTL_MS);
        assert.equal(ok - now, TERMINAL_TTL_MS);
        assert.ok(unk > ok);
    });
});
