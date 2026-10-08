const test = require("node:test");
const assert = require("node:assert/strict");
const UserAccount = require("../src/models/user-account");
const AccountConfig = require("../src/models/account-config");
const SignalInfo = require("../src/models/signal-info");
const AccountStatic = require("../src/models/account-static");
const MonitorPosition = require("../src/models/monitor-position");
const SummaryCache = require("../src/models/summary-cache");
const { getSystemSummary, getCachedSystemSummary, clearSystemSummaryCache, normalizeSummaryRange, dateFilter, startOfUtcDay } = require("../src/lib/system-summary");

function findQuery(rows) {
    return { select() { return this; }, lean: async () => rows };
}

test("system summary ranks account-static profit without listing every identity", async (t) => {
    t.mock.method(UserAccount, "find", () => findQuery([
        { username: "alpha", accounts: ["A", "B"], visibility: "public", active: true },
        { username: "beta", accounts: ["C"], visibility: "private" },
        { username: "gamma", accounts: ["D"], visibility: "public", active: false },
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
    t.mock.method(MonitorPosition, "countDocuments", async (filter) => {
        assert.deepEqual(filter.$or, [{ closed: false }, { isClosed: false }]);
        return 2;
    });
    t.mock.method(AccountStatic, "aggregate", async (pipeline) => {
        const match = pipeline[0].$match;
        assert.deepEqual(match.env.$in, ["A", "B", "C"]);
        assert.equal(match.isPaper, false);
        assert.equal(match.openTime, undefined);
        assert.match(JSON.stringify(match.$expr), /closeTime/);
        assert.match(JSON.stringify(match.$expr), /2026-10-04T12:00:00.000Z/);
        assert.equal(pipeline[1].$facet.totals[0].$group.profit.$sum.$ifNull[0], "$profit");
        assert.equal(pipeline[1].$facet.totals[0].$group.volume.$sum.$ifNull[0], "$volume");
        return [{
            totals: [{ tradeCount: 10, wins: 6, losses: 2, volume: 1000, profit: 40 }],
            today: [{ profit: -2 }],
            bySignal: [
                { _id: "SIGNAL_A", profit: 30, trades: 6, wins: 5, losses: 1 },
                { _id: "BULL", profit: -5, trades: 4, wins: 1, losses: 3 },
            ],
            bySymbol: [{ _id: "BTCUSDT", profit: 20, trades: 3, wins: 2, losses: 1 }],
            byEnv: [
                { _id: "A", profit: 25, volume: 400, trades: 4, wins: 3, losses: 1 },
                { _id: "C", profit: 15, volume: 600, trades: 6, wins: 3, losses: 3 },
                { _id: "D", profit: 90, volume: 50, trades: 1, wins: 1, losses: 0 },
            ],
            bySide: [{ _id: "LONG", profit: 50 }, { _id: "SHORT", profit: -10 }],
        }];
    });

    const result = await getSystemSummary("3d", new Date("2026-10-07T12:00:00.000Z"));

    assert.deepEqual(result, {
        botCount: 2, publicBotCount: 1, privateBotCount: 1,
        configCount: 3, activeConfigCount: 2, inactiveConfigCount: 1,
        signalCount: 40, signalCount24h: 7,
        tradeCount: 10, wins: 6, losses: 2, openPositionCount: 2, winRate: 75,
        profit: 40, profitToday: -2, volume: 1000,
        longProfit: 50, shortProfit: -10,
        bestSignal: { name: "SIGNAL_A", profit: 30, trades: 6, winRate: (5 / 6) * 100 },
        worstSignal: { name: "BULL", profit: -5, trades: 4, winRate: 25 },
        bestUser: { name: "alpha", profit: 25, trades: 4, winRate: 75 },
        userRanks: [
            { name: "alpha", profit: 25, volume: 400, trades: 4, wins: 3, losses: 1, winRate: 75 },
            { name: "beta", profit: 15, volume: 600, trades: 6, wins: 3, losses: 3, winRate: 50 },
        ],
        bestSymbol: { name: "BTCUSDT", profit: 20, trades: 3, winRate: (2 / 3) * 100 },
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
    assert.equal(normalizeSummaryRange("today"), "today");
    assert.throws(() => normalizeSummaryRange("365d"), /Khoảng thời gian không hợp lệ/);
});

test("today range starts at UTC midnight", () => {
    const filter = dateFilter("today", new Date("2026-10-07T12:34:56.000Z"));
    assert.equal(filter.$gte.toISOString(), "2026-10-07T00:00:00.000Z");
    assert.equal(filter.$lte.toISOString(), "2026-10-07T12:34:56.000Z");
});

test("summary cache persists and reuses an aggregate in MongoDB", async (t) => {
    let stored = null;
    t.mock.method(SummaryCache, "findOne", () => findQuery(stored ? { payload: stored } : null));
    t.mock.method(SummaryCache, "findOneAndUpdate", async (_filter, update) => { stored = update.$set.payload; });
    t.mock.method(SummaryCache, "deleteMany", async () => { stored = null; });
    await clearSystemSummaryCache();
    let reads = 0;
    t.mock.method(UserAccount, "find", () => { reads += 1; return findQuery([]); });
    t.mock.method(AccountConfig, "countDocuments", async () => 0);
    t.mock.method(SignalInfo, "countDocuments", async () => 0);
    t.mock.method(MonitorPosition, "countDocuments", async () => 0);
    t.mock.method(AccountStatic, "aggregate", async () => []);
    const now = new Date("2026-10-07T12:00:00.000Z");
    const first = await getCachedSystemSummary("7d", now);
    const second = await getCachedSystemSummary("7d", new Date(now.getTime() + 1000));
    assert.equal(first.cached, false);
    assert.equal(second.cached, true);
    assert.equal(reads, 1);
    await clearSystemSummaryCache();
});
