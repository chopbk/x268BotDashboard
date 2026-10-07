const test = require("node:test");
const assert = require("node:assert/strict");
const UserAccount = require("../src/models/user-account");
const AccountConfig = require("../src/models/account-config");
const SignalInfo = require("../src/models/signal-info");
const AccountStatic = require("../src/models/account-static");
const { getSystemSummary, startOfUtcDay } = require("../src/lib/system-summary");

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
    t.mock.method(SignalInfo, "countDocuments", async (filter) => filter ? 7 : 40);
    t.mock.method(AccountStatic, "aggregate", async (pipeline) => {
        assert.deepEqual(pipeline[0], { $match: { env: { $in: ["A", "B", "C"] } } });
        return [{ tradeCount: 10, openPositionCount: 2, wins: 6, losses: 2, profit: 25.5, profitToday: -2, volume: 1000 }];
    });

    const result = await getSystemSummary(new Date("2026-10-07T12:00:00.000Z"));

    assert.deepEqual(result, {
        botCount: 2, publicBotCount: 1, privateBotCount: 1,
        configCount: 3, activeConfigCount: 2, inactiveConfigCount: 1,
        signalCount: 40, signalCount24h: 7,
        tradeCount: 10, openPositionCount: 2, winRate: 75,
        profit: 25.5, profitToday: -2, volume: 1000,
        generatedAt: new Date("2026-10-07T12:00:00.000Z"),
    });
    assert.equal(Object.hasOwn(result, "envs"), false);
    assert.equal(Object.hasOwn(result, "usernames"), false);
});

test("UTC day boundary is stable for profit-today aggregation", () => {
    assert.equal(startOfUtcDay(new Date("2026-10-07T23:59:59.000Z")).toISOString(), "2026-10-07T00:00:00.000Z");
});
