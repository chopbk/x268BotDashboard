const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const {
    ALLOWLIST,
    resolveStatusTransition,
    evaluateRoleAcks,
    roleTerminalFromPayload,
    publicCommand,
} = require("../src/lib/bot-command-bridge");
const {
    resolveStatusTransition: resolveTx,
    evaluateRoleAcks: evalRoles,
    roleTerminalFromPayload: roleTerm,
} = require("../src/lib/bot-command-status");

test("allowlist chỉ sync config/account — không lộ OPEN/CLOSE hay status Telegram", () => {
    assert.equal(ALLOWLIST.OPEN, undefined);
    assert.equal(ALLOWLIST.CLOSE, undefined);
    assert.equal(ALLOWLIST.GET_POSITIONS, undefined);
    assert.equal(ALLOWLIST.APPLY_CONFIG.permission, "config.edit");
    assert.deepEqual(ALLOWLIST.APPLY_CONFIG.requiredRoles, ["TRADER"]);
    assert.equal(ALLOWLIST.LOAD_ACCOUNT.permission, "config.edit");
});

test("publicCommand null-safe", () => {
    assert.equal(publicCommand(null), null);
});

describe("status monotonic", () => {
    test("không cho running → received", () => {
        const tx = resolveStatusTransition("running", "received");
        assert.equal(tx.accepted, false);
        assert.equal(tx.regress, true);
        assert.equal(tx.status, "running");
        assert.equal(resolveTx("running", "received").status, "running");
    });

    test("cho phép published → received → running → succeeded", () => {
        assert.equal(resolveStatusTransition("published", "received").accepted, true);
        assert.equal(resolveStatusTransition("received", "running").accepted, true);
        assert.equal(resolveStatusTransition("running", "succeeded").accepted, true);
        assert.equal(resolveStatusTransition("running", "failed").accepted, true);
    });

    test("terminal không đổi", () => {
        assert.equal(resolveStatusTransition("succeeded", "failed").accepted, false);
        assert.equal(resolveStatusTransition("expired", "succeeded").accepted, false);
        assert.equal(resolveStatusTransition("failed", "running").accepted, false);
    });
});

describe("role ACK aggregation", () => {
    test("MONITOR succeeded không đủ khi required TRADER", () => {
        const r = evaluateRoleAcks(["TRADER"], {
            MONITOR: { status: "succeeded", terminal: true, applied: ["DEMO_1"] },
        });
        assert.equal(r.terminal, false);
        assert.equal(evalRoles(["TRADER"], {
            MONITOR: { status: "succeeded", terminal: true },
        }).terminal, false);
    });

    test("TRADER succeeded → overall succeeded", () => {
        const r = evaluateRoleAcks(["TRADER"], {
            TRADER: { status: "succeeded", terminal: true, applied: ["DEMO_1"] },
            MONITOR: { status: "succeeded", terminal: true },
        });
        assert.equal(r.status, "succeeded");
        assert.equal(r.terminal, true);
    });

    test("TRADER failed → overall failed", () => {
        const r = evaluateRoleAcks(["TRADER"], {
            TRADER: { status: "failed", terminal: true },
        });
        assert.equal(r.status, "failed");
        assert.equal(r.terminal, true);
    });

    test("TRADER running → overall running", () => {
        const r = evaluateRoleAcks(["TRADER"], {
            TRADER: { status: "running", terminal: false },
        });
        assert.equal(r.status, "running");
        assert.equal(r.terminal, false);
    });
});

describe("roleTerminalFromPayload / applied", () => {
    test("succeeded mà targetEnv không trong applied → failed khi requireApplied", () => {
        const r = roleTerminalFromPayload(
            {
                status: "succeeded",
                terminal: true,
                applied: ["OTHER"],
            },
            "DEMO_1",
            { requireApplied: true }
        );
        assert.equal(r.status, "failed");
        assert.equal(r.terminal, true);
        assert.equal(roleTerm(
            { status: "succeeded", terminal: true, applied: ["OTHER"] },
            "DEMO_1",
            { requireApplied: true }
        ).status, "failed");
    });

    test("succeeded và targetEnv trong applied → succeeded", () => {
        const r = roleTerminalFromPayload(
            {
                status: "succeeded",
                terminal: true,
                applied: ["DEMO_1", "DEMO_1_COPY"],
            },
            "DEMO_1",
            { requireApplied: true }
        );
        assert.equal(r.status, "succeeded");
        assert.equal(r.terminal, true);
    });

    test("running không terminal", () => {
        const r = roleTerminalFromPayload({ status: "running", terminal: false }, "DEMO_1");
        assert.equal(r.status, "running");
        assert.equal(r.terminal, false);
    });

    test("allowlist có LOAD/UNLOAD/RENAME account", () => {
        assert.equal(ALLOWLIST.LOAD_ACCOUNT.kind, "account_runtime");
        assert.equal(ALLOWLIST.UNLOAD_ACCOUNT.runtimeAction, "unload");
        assert.equal(ALLOWLIST.RENAME_ACCOUNT.runtimeAction, "rename");
    });
});
