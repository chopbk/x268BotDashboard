const test = require("node:test");
const assert = require("node:assert/strict");
process.env.WEB_JWT_SECRET = "test-secret-at-least-16-characters";

const UserAccount = require("../src/models/user-account");
const AccountStatic = require("../src/models/account-static");
const { listAccountStatics, getAccountStatic } = require("../src/lib/account-statics");

function query(value) {
    return { select() { return this; }, sort() { return this; }, skip() { return this; }, limit() { return this; }, lean() { return Promise.resolve(value); }, then(ok, fail) { return Promise.resolve(value).then(ok, fail); } };
}

test("Account Static is scoped to the selected config and returns profit statistics", async () => {
    const originals = { user: UserAccount.findOne, rows: AccountStatic.find, count: AccountStatic.countDocuments, aggregate: AccountStatic.aggregate };
    let rowFilter;
    UserAccount.findOne = () => query({ username: "alpha", accounts: ["a1", "a2"], visibility: "public" });
    AccountStatic.find = (filter) => { rowFilter = filter; return query([{ _id: "s1", env: "a1", typeSignal: "SIGNAL_A", symbol: "BTCUSDT", side: "LONG", status: "WIN", profit: 12, roe: 4, openTime: new Date() }]); };
    AccountStatic.countDocuments = async () => 1;
    AccountStatic.aggregate = async (pipeline) => (pipeline[1]?.$facet
        ? [{ bySignal: [{ _id: "SIGNAL_A", count: 1, profit: 12, wins: 1, losses: 0 }], byStatus: [{ _id: "WIN", count: 1, profit: 12 }] }]
        : [{ profit: 12, roi: 4, volume: 100, wins: 1, losses: 0 }]);
    try {
        const result = await listAccountStatics({ role: "viewer", botUsernames: ["alpha"] }, { username: "alpha", env: "a1" });
        assert.deepEqual(rowFilter.env, { $in: ["a1"] });
        const span = Date.now() - rowFilter.openTime.$gte.getTime();
        assert.ok(span > 2.9 * 24 * 60 * 60 * 1000 && span < 3.1 * 24 * 60 * 60 * 1000);
        assert.equal(result.stats.profit, 12);
        assert.equal(result.stats.winRate, 100);
        assert.equal(result.stats.bySignal[0].winRate, 100);
        assert.equal(result.stats.byStatus[0].status, "WIN");
        assert.equal(result.rows[0].signal, "SIGNAL_A");
    } finally {
        UserAccount.findOne = originals.user;
        AccountStatic.find = originals.rows;
        AccountStatic.countDocuments = originals.count;
        AccountStatic.aggregate = originals.aggregate;
    }
});

test("Account Static filters signal, status and profit without narrowing the signal breakdown", async () => {
    const originals = { user: UserAccount.findOne, rows: AccountStatic.find, count: AccountStatic.countDocuments, aggregate: AccountStatic.aggregate };
    let rowFilter;
    let scope;
    UserAccount.findOne = () => query({ username: "alpha", accounts: ["a1"], visibility: "public" });
    AccountStatic.find = (filter) => { rowFilter = filter; return query([]); };
    AccountStatic.countDocuments = async () => 0;
    AccountStatic.aggregate = async (pipeline) => {
        if (pipeline[1]?.$facet) scope = pipeline[0].$match;
        return pipeline[1]?.$facet ? [{ bySignal: [], byStatus: [] }] : [{ profit: 0, roi: 0, volume: 0, wins: 0, losses: 0 }];
    };
    try {
        await listAccountStatics({ role: "viewer", botUsernames: ["alpha"] }, { username: "alpha", signal: "signal_a+", status: "win", profit: "loss" });
        assert.equal(rowFilter.typeSignal.source, "^signal_a\\+$");
        assert.equal(rowFilter.status, "WIN");
        assert.deepEqual(rowFilter.profit, { $lt: 0 });
        assert.equal(scope.typeSignal, undefined);
        assert.equal(scope.status, undefined);
        assert.equal(scope.profit, undefined);
    } finally {
        UserAccount.findOne = originals.user;
        AccountStatic.find = originals.rows;
        AccountStatic.countDocuments = originals.count;
        AccountStatic.aggregate = originals.aggregate;
    }
});

test("Account Static detail stays inside the selected bot", async () => {
    const originals = { user: UserAccount.findOne, one: AccountStatic.findOne };
    let detailFilter;
    UserAccount.findOne = () => query({ username: "alpha", accounts: ["a1"], visibility: "public" });
    AccountStatic.findOne = (filter) => { detailFilter = filter; return query({ _id: "a".repeat(24), env: "a1", typeSignal: "SIGNAL_A", symbol: "BTCUSDT", side: "LONG", status: "WIN", profit: 3, tps: [1, 2], positionAmt: 0.1, isCopy: true }); };
    try {
        await assert.rejects(() => getAccountStatic({ role: "viewer", botUsernames: ["alpha"] }, "nope", { username: "alpha" }), /Mã giao dịch không hợp lệ/);
        const row = await getAccountStatic({ role: "viewer", botUsernames: ["alpha"] }, "a".repeat(24), { username: "alpha" });
        assert.deepEqual(detailFilter.env, { $in: ["a1"] });
        assert.equal(row.signal, "SIGNAL_A");
        assert.deepEqual(row.tps, [1, 2]);
        assert.equal(row.copy, true);
        assert.equal(row.positionAmt, 0.1);
    } finally {
        UserAccount.findOne = originals.user;
        AccountStatic.findOne = originals.one;
    }
});
