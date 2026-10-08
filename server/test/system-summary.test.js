const test = require("node:test");
const assert = require("node:assert/strict");
const UserAccount = require("../src/models/user-account");
const AccountConfig = require("../src/models/account-config");
const SignalInfo = require("../src/models/signal-info");
const AccountStatic = require("../src/models/account-static");
const FuturesProfit = require("../src/models/futures-profit");
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
    t.mock.method(MonitorPosition, "countDocuments", async (filter) => {
        assert.deepEqual(filter.closed, { $ne: true });
        assert.deepEqual(filter.isPaper, { $ne: true });
        assert.deepEqual(filter["config.PAPER"], { $ne: true });
        assert.equal(filter.$or, undefined);
        return 2;
    });
    t.mock.method(FuturesProfit, "aggregate", async (pipeline) => {
        const match = pipeline[0].$match;
        assert.deepEqual(match.env.$in, ["A", "B", "C"]);
        assert.equal(match.day.$gte.toISOString(), "2026-10-04T00:00:00.000Z");
        return [
            { _id: "A", profit: 11, balance: 500, roi: 2.5 },
            { _id: "C", profit: 4, balance: 80, roi: -1 },
        ];
    });
    t.mock.method(AccountStatic, "aggregate", async (pipeline) => {
        const match = pipeline[0].$match;
        if (match.openTime) {
            assert.deepEqual(match.env.$in, ["A", "B", "C"]);
            assert.deepEqual(match.isPaper, { $ne: true });
            return [{ _id: "ROSE", recent: 1 }, { _id: "BULL", recent: 0 }];
        }
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
        signalCount: 2, signalCount24h: 1,
        tradeCount: 10, wins: 6, losses: 2, openPositionCount: 2, winRate: 75,
        profit: 40, profitToday: -2, volume: 1000,
        longProfit: 50, shortProfit: -10,
        bestSignal: { name: "SIGNAL_A", profit: 30, trades: 6, winRate: (5 / 6) * 100 },
        worstSignal: { name: "BULL", profit: -5, trades: 4, winRate: 25 },
        bestUser: { name: "alpha", profit: 11, trades: 4, winRate: 75 },
        userRanks: [
            { name: "alpha", profit: 11, balance: 500, roi: 2.5, volume: 400, trades: 4, wins: 3, losses: 1, winRate: 75 },
            { name: "beta", profit: 4, balance: 80, roi: -1, volume: 600, trades: 6, wins: 3, losses: 3, winRate: 50 },
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

test("summary range defaults to today and rejects unknown values", () => {
    assert.equal(normalizeSummaryRange(), "today");
    assert.equal(normalizeSummaryRange("today"), "today");
    assert.throws(() => normalizeSummaryRange("365d"), /Khoảng thời gian không hợp lệ/);
});

test("today range starts at UTC midnight", () => {
    const filter = dateFilter("today", new Date("2026-10-07T12:34:56.000Z"));
    assert.equal(filter.$gte.toISOString(), "2026-10-07T00:00:00.000Z");
    assert.equal(filter.$lte.toISOString(), "2026-10-07T12:34:56.000Z");
});

test("scoped summary keeps only accounts the actor may view", async (t) => {
    t.mock.method(UserAccount, "find", () => findQuery([
        { username: "alpha", accounts: ["A"], ownerUserId: "member-id", visibility: "public", active: true },
        { username: "beta", accounts: ["C"], ownerUserId: "other", visibility: "public", active: true },
    ]));
    t.mock.method(AccountConfig, "countDocuments", async (filter) => {
        assert.deepEqual(filter.env.$in, ["A"]);
        return 1;
    });
    t.mock.method(SignalInfo, "countDocuments", async () => 0);
    t.mock.method(MonitorPosition, "countDocuments", async (filter) => {
        assert.deepEqual(filter.env.$in, ["A"]);
        assert.deepEqual(filter.closed, { $ne: true });
        assert.deepEqual(filter.isPaper, { $ne: true });
        assert.deepEqual(filter["config.PAPER"], { $ne: true });
        return 1;
    });
    t.mock.method(AccountStatic, "aggregate", async () => [{ byEnv: [] }]);
    t.mock.method(FuturesProfit, "aggregate", async (pipeline) => {
        assert.deepEqual(pipeline[0].$match.env.$in, ["A"]);
        return [{ _id: "A", profit: 9, balance: 120, roi: 3 }];
    });
    const result = await getSystemSummary("today", new Date("2026-10-07T12:00:00.000Z"), {
        id: "member-id", role: "member", botUsernames: [],
    });
    assert.equal(result.botCount, 1);
    assert.equal(result.openPositionCount, 1);
    assert.deepEqual(result.userRanks, [
        { name: "alpha", profit: 9, balance: 120, roi: 3, volume: 0, trades: 0, wins: 0, losses: 0, winRate: 0 },
    ]);
});

test("mine view keeps owned and assigned bots, system view adds the rest allowed", async (t) => {
    const bots = [
        { username: "alpha", accounts: ["A"], ownerUserId: "sup", visibility: "public", active: true },
        { username: "beta", accounts: ["B"], ownerUserId: "other", visibility: "public", active: true },
        { username: "gamma", accounts: ["G"], ownerUserId: "other", visibility: "public", active: true },
        { username: "secret", accounts: ["S"], ownerUserId: "other", visibility: "private", active: true },
    ];
    const actor = { id: "sup", role: "supervisor", botUsernames: ["beta"] };
    const seen = [];
    t.mock.method(UserAccount, "find", () => findQuery(bots));
    t.mock.method(AccountConfig, "countDocuments", async (filter) => { seen.push(filter.env.$in); return 0; });
    t.mock.method(SignalInfo, "countDocuments", async () => 0);
    t.mock.method(MonitorPosition, "countDocuments", async () => 0);
    t.mock.method(AccountStatic, "aggregate", async () => [{ byEnv: [] }]);
    t.mock.method(FuturesProfit, "aggregate", async () => []);
    const now = new Date("2026-10-07T12:00:00.000Z");
    await getSystemSummary("today", now, actor, "mine");
    await getSystemSummary("today", now, actor, "system");
    assert.deepEqual(seen[0], ["A", "B"]);
    assert.deepEqual(seen[1], ["A", "B", "G"]);
});

test("system view follows a wider bots or statistics scope than summary.view", async (t) => {
    t.mock.method(UserAccount, "find", () => findQuery([
        { username: "alpha", accounts: ["A"], ownerUserId: "vx", visibility: "public", active: true },
        { username: "beta", accounts: ["B"], ownerUserId: "other", visibility: "public", active: true },
        { username: "gamma", accounts: ["G"], ownerUserId: "other", visibility: "public", active: true },
    ]));
    const seen = [];
    t.mock.method(AccountConfig, "countDocuments", async (filter) => { seen.push([...(filter.env?.$in || [])]); return 0; });
    t.mock.method(SignalInfo, "countDocuments", async () => 0);
    t.mock.method(MonitorPosition, "countDocuments", async () => 0);
    t.mock.method(AccountStatic, "aggregate", async () => [{ byEnv: [] }]);
    t.mock.method(FuturesProfit, "aggregate", async () => []);
    const actor = {
        id: "vx", role: "collaborator", username: "vx268", botUsernames: ["beta"],
        permissionScopes: { "bots.view": "all", "statistics.view": "all" },
    };
    const now = new Date("2026-10-07T12:00:00.000Z");
    const mine = await getSystemSummary("today", now, actor, "mine");
    const system = await getSystemSummary("today", now, actor, "system");
    assert.deepEqual(mine.userRanks.map((row) => row.name), ["alpha", "beta"]);
    assert.deepEqual(system.userRanks.map((row) => row.name), ["alpha", "beta", "gamma"]);
    assert.deepEqual(seen[0], ["A", "B"]);
    assert.deepEqual(seen[1], ["A", "B", "G"]);
});

test("summary.view all does not widen the system audience", async (t) => {
    t.mock.method(UserAccount, "find", () => findQuery([
        { username: "alpha", accounts: ["A"], ownerUserId: "vx", visibility: "public", active: true },
        { username: "gamma", accounts: ["G"], ownerUserId: "other", visibility: "public", active: true },
    ]));
    t.mock.method(AccountConfig, "countDocuments", async (filter) => {
        assert.deepEqual(filter.env.$in, ["A"]);
        return 0;
    });
    t.mock.method(SignalInfo, "countDocuments", async () => 0);
    t.mock.method(MonitorPosition, "countDocuments", async () => 0);
    t.mock.method(AccountStatic, "aggregate", async () => [{ byEnv: [] }]);
    t.mock.method(FuturesProfit, "aggregate", async () => []);
    const actor = {
        id: "vx", role: "collaborator", username: "vx268", botUsernames: [],
        permissionScopes: { "summary.view": "all" },
    };
    const result = await getSystemSummary("today", new Date("2026-10-07T12:00:00.000Z"), actor, "system");
    assert.deepEqual(result.userRanks.map((row) => row.name), ["alpha"]);
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
    t.mock.method(FuturesProfit, "aggregate", async () => []);
    const now = new Date("2026-10-07T12:00:00.000Z");
    const first = await getCachedSystemSummary("7d", now);
    const second = await getCachedSystemSummary("7d", new Date(now.getTime() + 1000));
    assert.equal(first.cached, false);
    assert.equal(second.cached, true);
    assert.equal(reads, 1);
    await clearSystemSummaryCache();
});
