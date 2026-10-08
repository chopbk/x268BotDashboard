const test = require("node:test");
const assert = require("node:assert/strict");
process.env.WEB_JWT_SECRET = "test-secret-at-least-16-characters";

const RuntimeLog = require("../src/models/runtime-log");
const { listFilter, listRuntimeLogs } = require("../src/lib/runtime-logs");

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
    const originals = { rows: RuntimeLog.find, count: RuntimeLog.countDocuments };
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
    try {
        const result = await listRuntimeLogs({ role: "admin" }, { category: "open" });
        assert.equal(result.logs[0].message, "create bot failed");
        assert.equal(result.logs[0].category, "open");
        assert.equal(JSON.stringify(result).includes("should-not-leak"), false);
        assert.equal(result.total, 1);
    } finally {
        RuntimeLog.find = originals.rows;
        RuntimeLog.countDocuments = originals.count;
    }
});
