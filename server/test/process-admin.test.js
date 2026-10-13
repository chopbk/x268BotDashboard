const test = require("node:test");
const assert = require("node:assert/strict");
const {
    mergePatch,
    validateRuntimeLike,
    enrichProcessRow,
    matchProfileKey,
    shouldRedactKey,
    redactVariables,
} = require("../src/lib/process-admin");
const { assessHealth } = require("../src/lib/system-health");

test("mergePatch unsets role flags instead of storing false", () => {
    const next = mergePatch(
        { TRADER: "true", RUN: "alpha", NODE_ENV: "prod", MQTT: "PROD" },
        { MQTT: "STAGING" },
        ["TRADER"]
    );
    assert.equal(next.TRADER, undefined);
    assert.equal(next.MQTT, "STAGING");
    assert.equal(next.RUN, "alpha");
});

test("mergePatch rejects forbidden and bootstrap keys", () => {
    assert.throws(() => mergePatch({}, { MONGODB: "mongodb://x" }, []), /không được phép/);
    assert.throws(() => mergePatch({}, { REDIS_URL: "redis://x" }, []), /không được phép/);
    assert.throws(() => mergePatch({}, { BOT_ENV: "X" }, []), /không được phép/);
});

test("validateRuntimeLike requires RUN for trader and TELE_CLIENT for listener", () => {
    assert.deepEqual(
        validateRuntimeLike({ NODE_ENV: "prod", TRADER: "true" }).filter((e) => /RUN/.test(e)),
        ["RUN is required when TRADER or MONITOR is enabled"]
    );
    assert.ok(
        validateRuntimeLike({ NODE_ENV: "prod", LISTENER: "true" }).some((e) => /TELE_CLIENT/.test(e))
    );
    assert.deepEqual(
        validateRuntimeLike({
            NODE_ENV: "prod",
            TRADER: "true",
            RUN: "u1",
            LISTENER: "true",
            TELE_CLIENT: "ROSE",
        }),
        []
    );
});

test("enrichProcessRow computes drift and attaches last command", () => {
    const profilesByEnv = new Map([
        ["TRADER_PROD", { env: "TRADER_PROD", revision: 3, active: true }],
    ]);
    const lastCommandByEnv = new Map([
        ["TRADER_PROD", { id: "c1", status: "queued", kind: "restart", statusReason: "" }],
    ]);
    const ok = enrichProcessRow(
        {
            processName: "trader",
            botEnv: "TRADER_PROD",
            status: "ok",
            profileRevision: 3,
        },
        profilesByEnv,
        lastCommandByEnv
    );
    assert.equal(ok.drift, "ok");
    assert.equal(ok.desiredRevision, 3);
    assert.equal(ok.actualRevision, 3);
    assert.equal(ok.lastCommand.id, "c1");

    const mismatch = enrichProcessRow(
        { processName: "trader", botEnv: "TRADER_PROD", status: "ok", profileRevision: 2 },
        profilesByEnv,
        lastCommandByEnv
    );
    assert.equal(mismatch.drift, "mismatch");

    const stale = enrichProcessRow(
        { processName: "trader", botEnv: "TRADER_PROD", status: "down", profileRevision: 3 },
        profilesByEnv,
        lastCommandByEnv
    );
    assert.equal(stale.drift, "stale");

    const none = enrichProcessRow(
        { processName: "orphan", status: "ok" },
        profilesByEnv,
        lastCommandByEnv
    );
    assert.equal(none.drift, "no_profile");
});

test("matchProfileKey prefers botEnv then processName then nodeEnv", () => {
    const map = new Map([
        ["A", {}],
        ["B", {}],
        ["C", {}],
    ]);
    assert.equal(matchProfileKey({ botEnv: "A", processName: "B", nodeEnv: "C" }, map), "A");
    assert.equal(matchProfileKey({ processName: "B", nodeEnv: "C" }, map), "B");
    assert.equal(matchProfileKey({ nodeEnv: "C" }, map), "C");
    assert.equal(matchProfileKey({ processName: "x" }, map), null);
});

test("redact hides secret-like keys", () => {
    assert.equal(shouldRedactKey("REDIS_URL"), true);
    assert.equal(shouldRedactKey("API_KEY"), true);
    assert.equal(shouldRedactKey("TELE_CLIENT"), false);
    const redacted = redactVariables({ TELE_CLIENT: "ROSE", SOME_TOKEN: "abcdef" });
    assert.equal(redacted.TELE_CLIENT, "ROSE");
    assert.match(String(redacted.SOME_TOKEN), /\*\*\*/);
});

test("assessHealth surfaces profile drift fields on processes", () => {
    const now = new Date("2026-10-08T12:00:00.000Z");
    const profilesByEnv = new Map([["TRADER", { env: "TRADER", revision: 5, active: true }]]);
    const health = assessHealth({
        now,
        mongoOk: true,
        redis: "redis",
        redisConfigured: true,
        heartbeats: [
            {
                key: "trader:0",
                processName: "trader",
                botEnv: "TRADER",
                at: now,
                flags: { trader: true },
                mqtt: "prod",
                mqttConnected: true,
                run: ["V"],
                nodeEnv: "prod",
                profileRevision: 4,
                hostId: "host-a",
            },
        ],
        profilesByEnv,
        lastCommandByEnv: new Map(),
    });
    const row = health.processes[0];
    assert.equal(row.profileEnv, "TRADER");
    assert.equal(row.desiredRevision, 5);
    assert.equal(row.actualRevision, 4);
    assert.equal(row.drift, "mismatch");
    assert.equal(row.hostId, "host-a");
    assert.equal(JSON.stringify(health).includes("mongodb://"), false);
});
