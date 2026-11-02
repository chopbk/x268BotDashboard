const test = require("node:test");
const assert = require("node:assert/strict");
process.env.WEB_JWT_SECRET = "test-secret-at-least-16-characters";

const RuntimeLog = require("../src/models/runtime-log");
const { listFilter, listRuntimeLogs, aggregateRuntimeHistogram } = require("../src/lib/runtime-logs");

function query(value) {
    return { sort() { return this; }, skip() { return this; }, limit() { return this; }, lean() { return Promise.resolve(value); } };
}

test("runtime log scope hides system categories from a bot user", () => {
    const scoped = listFilter({ role: "operator", botUsernames: ["V"] }, { category: "open" });
    const clauses = scoped.$and || [scoped];
    assert.deepEqual(clauses.find((item) => item.category === "open"), { category: "open" });
    assert.deepEqual(clauses.find((item) => item.usernames), { usernames: { $in: ["V"] } });
    assert.deepEqual(clauses.find((item) => item.category && item.category.$nin).category.$nin.sort(), ["listener", "mqtt", "process"]);

    const all = listFilter({ role: "admin", botUsernames: [] }, { category: "mqtt" });
    assert.deepEqual(all, { category: "mqtt" });
});

test("runtime log list returns only report fields", async () => {
    const originals = { rows: RuntimeLog.find, count: RuntimeLog.countDocuments, aggregate: RuntimeLog.aggregate };
    RuntimeLog.find = () => query([{
        _id: "1",
        at: new Date("2026-10-07T00:00:00Z"),
        level: "error",
        category: "open",
        role: "TRADER",
        processName: "trader-v",
        pmId: "3",
        usernames: ["V"],
        env: "V",
        symbol: "BTCUSDT",
        signal: "SIGNAL_A",
        source: "callHandleSignalBot",
        message: "create bot failed",
        api_key: "should-not-leak",
    }]);
    RuntimeLog.countDocuments = async () => 1;
    RuntimeLog.aggregate = async () => ([
        { _id: { bucket: "2026-10-07T00:00:00.000Z", level: "error" }, count: 1 },
    ]);
    try {
        const result = await listRuntimeLogs({ role: "admin" }, {
            category: "open",
            from: "2026-10-07T00:00:00.000Z",
            to: "2026-10-07T01:00:00.000Z",
        });
        assert.equal(result.logs[0].message, "create bot failed");
        assert.equal(result.logs[0].category, "open");
        assert.equal(JSON.stringify(result).includes("should-not-leak"), false);
        assert.equal(result.total, 1);
        assert.equal(result.histogram.total, 1);
        assert.equal(result.histogram.bucket, "hour");
    } finally {
        RuntimeLog.find = originals.rows;
        RuntimeLog.countDocuments = originals.count;
        RuntimeLog.aggregate = originals.aggregate;
    }
});

test("histogram aggregate ignores level filter and respects scope", async () => {
    const originals = { aggregate: RuntimeLog.aggregate };
    let matched;
    RuntimeLog.aggregate = async (pipeline) => {
        matched = pipeline[0].$match;
        return [
            { _id: { bucket: "2026-11-01", level: "error" }, count: 3 },
            { _id: { bucket: "2026-11-01", level: "warn" }, count: 2 },
        ];
    };
    try {
        const actor = { role: "operator", botUsernames: ["V"], permissions: ["logs.view"] };
        // scopeForPermission may need permissionScopes — use admin for all scope
        const admin = { role: "admin", botUsernames: [], permissions: ["logs.view"] };
        const result = await aggregateRuntimeHistogram(admin, {
            level: "error",
            // >48h → day buckets (đúng 48h có thể vẫn hour)
            from: "2026-11-01T00:00:00.000Z",
            to: "2026-11-04T00:00:00.000Z",
        });
        assert.equal(matched.level, undefined);
        assert.equal(result.bucket, "day");
        assert.equal(result.points.find((p) => p.t === "2026-11-01").error, 3);
        assert.equal(result.points.find((p) => p.t === "2026-11-01").warn, 2);
        assert.equal(result.total, 5);

        const scoped = listFilter(actor, { category: "open", level: "error" }, { includeLevel: false });
        const clauses = scoped.$and || [scoped];
        assert.equal(clauses.some((item) => item.level === "error"), false);
        assert.ok(clauses.some((item) => item.usernames));
    } finally {
        RuntimeLog.aggregate = originals.aggregate;
    }
});
