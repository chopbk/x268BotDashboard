const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const {
    decideInfraOutcome,
    decideFenceAfterWrite,
    withAccountLock,
} = require("../src/lib/risk-reservation");

describe("predeploy fix4 — web observe/enforce infra", () => {
    let prevEnforce;

    beforeEach(() => {
        prevEnforce = process.env.RISK_ENFORCE_READY;
    });
    afterEach(() => {
        if (prevEnforce == null) delete process.env.RISK_ENFORCE_READY;
        else process.env.RISK_ENFORCE_READY = prevEnforce;
    });

    it("observe continues on lock/DB failure; enforce rejects", () => {
        const obs = decideInfraOutcome({ mode: "observe", reason: "mock lock DB failure" });
        assert.equal(obs.allowed, true);
        assert.match(obs.reason, /observe_continue:mock lock DB failure/);
        assert.equal(obs.observedOnly, true);

        const enf = decideInfraOutcome({ mode: "enforce", reason: "mock lock DB failure" });
        assert.equal(enf.allowed, false);
        assert.equal(enf.reason, "mock lock DB failure");
        assert.equal(enf.code, "risk_rejected");
    });

    it("fence after write: enforce forces allowed false and keeps prior reservation", () => {
        const out = decideFenceAfterWrite({
            mode: "enforce",
            reason: "lock_fenced_after",
            priorResult: {
                allowed: true,
                mode: "enforce",
                reservation: { reservationId: "res-1", status: "reserved" },
            },
        });
        assert.equal(out.allowed, false);
        assert.equal(out.reason, "lock_fenced_after");
        assert.equal(out.reservation.reservationId, "res-1");
        assert.equal(out.fenceWarning, "lock_fenced_after");
    });

    it("fence after write: observe keeps allowed true with warning", () => {
        const out = decideFenceAfterWrite({
            mode: "observe",
            reason: "lock_fenced_after",
            priorResult: { allowed: true, mode: "observe", reservation: null },
        });
        assert.equal(out.allowed, true);
        assert.match(out.reason, /observe_continue/);
        assert.equal(out.fenceWarning, "lock_fenced_after");
    });

    it("withAccountLock returns ok:false instead of throwing when Mongo upsert fails", async () => {
        const RiskAccountLock = require("../src/models/risk-account-lock");
        const orig = RiskAccountLock.updateOne;
        RiskAccountLock.updateOne = async () => {
            throw new Error("mock lock DB failure");
        };
        try {
            const locked = await withAccountLock("acct-test", async () => ({ allowed: true }));
            assert.equal(locked.ok, false);
            assert.match(locked.reason, /lock_upsert_error:mock lock DB failure/);
        } finally {
            RiskAccountLock.updateOne = orig;
        }
    });
});
