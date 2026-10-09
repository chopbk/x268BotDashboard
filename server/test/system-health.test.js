const test = require("node:test");
const assert = require("node:assert/strict");
const { assessHealth } = require("../src/lib/system-health");

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
