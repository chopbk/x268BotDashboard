const test = require("node:test");
const assert = require("node:assert/strict");
const { assessHealth, formatCredentialAlert, STALE_MS } = require("../src/lib/system-health");

const now = new Date("2026-10-08T12:00:00.000Z");

function beat(extra) {
    return {
        key: "trader:0",
        processName: "trader",
        at: now,
        flags: { trader: true },
        mqtt: "prod",
        mqttConnected: true,
        run: ["V"],
        nodeEnv: "prod",
        memoryMb: 120,
        cpuPercent: 3,
        restarts: 1,
        ...extra,
    };
}

test("fresh trader with mqtt is ok and stale monitor is an alert", () => {
    const health = assessHealth({
        now,
        mongoOk: true,
        redis: "redis",
        redisConfigured: true,
        heartbeats: [
            beat(),
            beat({
                key: "monitor:1",
                processName: "monitor",
                flags: { monitor: true, trader: false },
                at: new Date(now.getTime() - 5 * 60 * 1000),
            }),
        ],
    });
    assert.equal(health.services.find((item) => item.id === "trader").status, "ok");
    assert.equal(health.services.find((item) => item.id === "monitor").status, "down");
    assert.equal(health.alerts.some((item) => item.code === "monitor"), true);
    assert.equal(health.alerts.some((item) => item.code === "mqtt"), false);
});

test("alerts cover mqtt, listener, redis fallback, snapshot, position and credential", () => {
    const health = assessHealth({
        now,
        mongoOk: true,
        redis: "memory",
        redisConfigured: true,
        heartbeats: [
            beat({ mqttConnected: false }),
            beat({
                key: "listener:2",
                processName: "tele",
                flags: { listener: true, trader: false },
                teleClient: "ROSE",
                teleVersion: "2",
                at: new Date(now.getTime() - 3 * 60 * 1000),
            }),
        ],
        snapshots: [{ range: "3d", status: "error", lastError: "agg failed", staleAt: now }],
        unmonitored: 2,
        credentials: [{ message: "Invalid API-key" }],
    });
    const codes = health.alerts.map((item) => item.code);
    assert.deepEqual(codes.filter((code, index) => codes.indexOf(code) === index).sort(), [
        "credential",
        "listener",
        "mqtt",
        "position",
        "redis",
        "snapshot",
    ]);
    assert.equal(JSON.stringify(health).includes("api_secret"), false);
    assert.equal(health.services.find((item) => item.id === "telegram-v2").status, "down");
});

test("old formula snapshots stay out of the alert list", () => {
    const past = new Date(now.getTime() - 60 * 1000);
    const future = new Date(now.getTime() + 60 * 1000);
    const quiet = assessHealth({
        now,
        snapshots: [
            { _id: "v1:today", range: "today", formulaVersion: "v1", status: "ready", staleAt: past },
            { _id: "v2:today", range: "today", formulaVersion: "v2", status: "ready", staleAt: past },
            { _id: "v4:today", range: "today", formulaVersion: "v4", status: "ready", staleAt: future },
        ],
    });
    assert.equal(quiet.alerts.some((item) => item.code === "snapshot"), false);
    const due = assessHealth({
        now,
        snapshots: [
            { _id: "v1:today", range: "today", formulaVersion: "v1", status: "ready", staleAt: past },
            { _id: "v3:today", range: "today", formulaVersion: "v3", status: "ready", staleAt: past },
            { _id: "v4:today", range: "today", formulaVersion: "v4", status: "ready", staleAt: past },
        ],
    });
    assert.equal(due.alerts.filter((item) => item.code === "snapshot").length, 1);
});

test("STALE_MS is 90 seconds for heartbeat cleanup", () => {
    assert.equal(STALE_MS, 90_000);
});

test("formatCredentialAlert includes process and RUN", () => {
    const text = formatCredentialAlert({
        processName: "trader-sgp",
        pmId: "2",
        host: "45.32.252.50",
        env: "TRADER_PROD",
        usernames: ["alice", "bob"],
        role: "TRADER",
        message: '{"code":-2015,"msg":"Invalid API-key, IP, or permissions for action, request ip: 139.180.133.147"}',
    });
    assert.match(text, /trader-sgp#2/);
    assert.match(text, /host=45\.32\.252\.50/);
    assert.match(text, /RUN=alice,bob/);
    assert.match(text, /-2015/);
});

test("down processes are listed so UI can offer delete-stale", () => {
    const health = assessHealth({
        now,
        heartbeats: [
            beat({ key: "alive:local", processName: "alive" }),
            beat({
                key: "dead:111",
                processName: "dead",
                at: new Date(now.getTime() - STALE_MS - 1),
            }),
            beat({
                key: "dead:222",
                processName: "dead-old",
                at: new Date(now.getTime() - 5 * 60 * 1000),
            }),
        ],
    });
    assert.equal(health.processes.filter((p) => p.status === "down").length, 2);
    assert.equal(health.processes.filter((p) => p.status === "ok").length, 1);
    const keys = health.processes.filter((p) => p.status === "down").map((p) => p.key);
    assert.deepEqual(keys.sort(), ["dead:111", "dead:222"]);
});
