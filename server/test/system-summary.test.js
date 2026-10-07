const test = require("node:test");
const assert = require("node:assert/strict");
const UserAccount = require("../src/models/user-account");
const AccountConfig = require("../src/models/account-config");
const SignalInfo = require("../src/models/signal-info");
const AccountStatic = require("../src/models/account-static");
const { getSystemSummary, getCachedSystemSummary, clearSystemSummaryCache, normalizeSummaryRange, startOfUtcDay } = require("../src/lib/system-summary");

function findQuery(rows) {
    return { select() { return this; }, lean: async () => rows };
}

test("system summary returns aggregate counts without resource identities", async (t) => {
    t.mock.method(UserAccount, "find", () => findQuery([
        { accounts: ["A", "B"], visibility: "public" },
        { accounts: ["C"], visibility: "private" },
    ]));
    t.mock.method(AccountConfig, "countDocuments", async (filter) => {
        assert.deepEqual(filter.env.$in, ["A", "B", "C"]);
        return 2;
    });
    let signalCall = 0;
    t.mock.method(SignalInfo, "countDocuments", async (filter) => {
        signalCall += 1;
        assert.ok(filter.openTime.$gte instanceof Date);
        return signalCall === 1 ? 40 : 7;
    });
    t.mock.method(AccountStatic, "countDocuments", async () => 2);
    t.mock.method(AccountStatic, "aggregate", async (pipeline) => {
        assert.deepEqual(pipeline[0].$match.env.$in, ["A", "B", "C"]);
        assert.equal(pipeline[0].$match.openTime.$gte.toISOString(), "2026-10-04T12:00:00.000Z");
        return [{ tradeCount: 10, wins: 6, losses: 2, profit: 25.5, profitToday: -2, volume: 1000 }];
    });

    const result = await getSystemSummary("3d", new Date("2026-10-07T12:00:00.000Z"));

    assert.deepEqual(result, {
        botCount: 2, publicBotCount: 1, privateBotCount: 1,
        configCount: 3, activeConfigCount: 2, inactiveConfigCount: 1,
        signalCount: 40, signalCount24h: 7,
        tradeCount: 10, openPositionCount: 2, winRate: 75,
        profit: 25.5, profitToday: -2, volume: 1000,
        range: "3d", from: new Date("2026-10-04T12:00:00.000Z"), to: new Date("2026-10-07T12:00:00.000Z"),
        generatedAt: new Date("2026-10-07T12:00:00.000Z"),
    });
    assert.equal(Object.hasOwn(result, "envs"), false);
    assert.equal(Object.hasOwn(result, "usernames"), false);
});

test("UTC day boundary is stable for profit-today aggregation", () => {
    assert.equal(startOfUtcDay(new Date("2026-10-07T23:59:59.000Z")).toISOString(), "2026-10-07T00:00:00.000Z");
});

test("summary range defaults to 3 days and rejects unknown values", () => {
    assert.equal(normalizeSummaryRange(), "3d");
    assert.throws(() => normalizeSummaryRange("365d"), /Khoảng thời gian không hợp lệ/);
});

test("summary cache reuses an aggregate within its TTL", async (t) => {
    clearSystemSummaryCache();
    let reads = 0;
    t.mock.method(UserAccount, "find", () => { reads += 1; return findQuery([]); });
    t.mock.method(AccountConfig, "countDocuments", async () => 0);
    t.mock.method(SignalInfo, "countDocuments", async () => 0);
    t.mock.method(AccountStatic, "countDocuments", async () => 0);
    t.mock.method(AccountStatic, "aggregate", async () => []);
    const now = new Date("2026-10-07T12:00:00.000Z");
    const first = await getCachedSystemSummary("7d", now);
    const second = await getCachedSystemSummary("7d", new Date(now.getTime() + 1000));
    assert.equal(first.cached, false);
    assert.equal(second.cached, true);
    assert.equal(reads, 1);
    clearSystemSummaryCache();
});
