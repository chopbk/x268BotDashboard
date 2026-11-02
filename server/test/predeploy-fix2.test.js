const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
    decideBindTransition,
    decideReleaseTransition,
    LOCK_MS,
} = require("../src/lib/risk-reservation");
const { assertEventAccess, TRUSTED_PRODUCERS } = require("../src/lib/trade-events");
const { guardOpenLegAfterClose } = require("../src/lib/exchanges/reverse-open-leg");
const { buildPortfolioSnapshot } = require("../src/lib/risk-portfolio");
const { httpError } = require("../src/lib/http");

describe("predeploy fix2 — timeline scope", () => {
    it("duplicate event thuộc account khác bị 403", () => {
        assert.throws(
            () => assertEventAccess(
                { account: "otherUser", source: "web", sourceEventId: "e1" },
                { expectedAccount: "myUser" }
            ),
            (err) => err.status === 403 || err.statusCode === 403
        );
    });

    it("duplicate cùng account + actor thiếu quyền bị 403", () => {
        assert.throws(
            () => assertEventAccess(
                { account: "botA" },
                {
                    expectedAccount: "botA",
                    actor: { id: "u1" },
                    canAccessBot: () => false,
                }
            ),
            (err) => err.status === 403 || err.statusCode === 403
        );
    });

    it("trusted producers không gồm web-user", () => {
        assert.equal(TRUSTED_PRODUCERS.has("web-user"), false);
        assert.ok(TRUSTED_PRODUCERS.has("web-trading-bridge"));
    });
});

describe("predeploy fix2 — reservation unknown không đi vòng client", () => {
    it("blocks unknown → submitted without reconcile", () => {
        const d = decideBindTransition("unknown", { status: "submitted", reconcile: false });
        assert.equal(d.ok, false);
        assert.equal(d.code, "risk_rejected");
    });

    it("blocks release of submitted without reconcile", () => {
        const d = decideReleaseTransition("submitted", { reconcile: false });
        assert.equal(d.ok, false);
        assert.equal(d.code, "risk_rejected");
    });

    it("blocks release of unknown without reconcile", () => {
        const d = decideReleaseTransition("unknown", { reconcile: false });
        assert.equal(d.ok, false);
    });

    it("allows reserved → submitted on public bind", () => {
        const d = decideBindTransition("reserved", { reconcile: false });
        assert.equal(d.ok, true);
        assert.equal(d.nextStatus, "submitted");
    });

    it("reconcile can move unknown → submitted then release", () => {
        const bind = decideBindTransition("unknown", { status: "submitted", reconcile: true });
        assert.equal(bind.ok, true);
        assert.equal(bind.nextStatus, "submitted");
        const rel = decideReleaseTransition("submitted", { reconcile: true });
        assert.equal(rel.ok, true);
        assert.equal(rel.nextStatus, "released");
    });

    it("exports lock lease constant for shared protocol", () => {
        assert.equal(LOCK_MS, 5_000);
    });
});

describe("predeploy fix2 — reverse open-leg gate throw", () => {
    it("keeps closeOk when beforeOpen throws", async () => {
        const out = await guardOpenLegAfterClose(async () => {
            throw new Error("Mongo lock failed");
        }, { phase: "open_leg" });
        assert.equal(out.proceed, false);
        assert.equal(out.closeOk, true);
        assert.equal(out.openBlocked, true);
        assert.equal(out.gateError, true);
        assert.match(out.reason, /Mongo lock failed/);
    });

    it("returns openBlocked when allowed:false", async () => {
        const out = await guardOpenLegAfterClose(async () => ({
            allowed: false,
            reason: "pause_new_entries",
        }), {});
        assert.equal(out.proceed, false);
        assert.equal(out.closeOk, true);
        assert.equal(out.openBlocked, true);
        assert.equal(out.gateError, false);
        assert.equal(out.reason, "pause_new_entries");
    });

    it("proceeds when gate allows", async () => {
        const out = await guardOpenLegAfterClose(async () => ({ allowed: true }), {});
        assert.equal(out.proceed, true);
    });
});

describe("predeploy fix2 — wallet shape", () => {
    it("maps reader balance → walletBalance; equity fallback marked", () => {
        const snap = buildPortfolioSnapshot({
            username: "u1",
            positions: [],
            wallet: { balance: 1000, available: 800, source: "redis", stale: false },
        });
        assert.equal(snap.walletBalance, 1000);
        assert.equal(snap.equity, 1000);
        assert.equal(snap.equityBasis, "wallet_balance_only");
        assert.ok(snap.provenance.missingFields.includes("equity_not_provided_used_wallet"));
        assert.equal(snap.walletStale, false);
        assert.equal(snap.available, 800);
    });

    it("keeps explicit equity separate from walletBalance", () => {
        const snap = buildPortfolioSnapshot({
            username: "u1",
            positions: [],
            wallet: { balance: 1000, equity: 1200, available: 500 },
        });
        assert.equal(snap.walletBalance, 1000);
        assert.equal(snap.equity, 1200);
        assert.equal(snap.equityBasis, "equity_incl_upnl_or_provided");
        assert.equal(
            snap.provenance.missingFields.includes("equity_not_provided_used_wallet"),
            false
        );
    });

    it("preserves stale/error provenance", () => {
        const snap = buildPortfolioSnapshot({
            username: "u1",
            positions: [],
            wallet: { balance: null, available: null, stale: true, source: "none", error: "timeout" },
        });
        assert.equal(snap.walletStale, true);
        assert.equal(snap.walletError, "timeout");
        assert.ok(snap.provenance.missingFields.includes("wallet_stale_or_missing"));
        assert.ok(snap.provenance.missingFields.includes("wallet_error"));
    });
});

describe("predeploy fix2 — lock fencing rules (pure)", () => {
    it("httpError helper available for fence loss", () => {
        const err = httpError(409, "Risk lock fence mất — dừng ghi", { code: "risk_rejected" });
        assert.equal(err.status || err.statusCode, 409);
    });
});
