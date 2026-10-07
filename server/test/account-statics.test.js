const test = require("node:test");
const assert = require("node:assert/strict");
process.env.WEB_JWT_SECRET = "test-secret-at-least-16-characters";

const UserAccount = require("../src/models/user-account");
const AccountStatic = require("../src/models/account-static");
const { listAccountStatics } = require("../src/lib/account-statics");

function query(value) {
    return { select() { return this; }, sort() { return this; }, skip() { return this; }, limit() { return this; }, lean() { return Promise.resolve(value); }, then(ok, fail) { return Promise.resolve(value).then(ok, fail); } };
}

test("Account Static is scoped to the selected config and returns profit statistics", async () => {
    const originals = { user: UserAccount.findOne, rows: AccountStatic.find, count: AccountStatic.countDocuments, aggregate: AccountStatic.aggregate };
    let rowFilter;
    UserAccount.findOne = () => query({ username: "alpha", accounts: ["a1", "a2"], visibility: "public" });
    AccountStatic.find = (filter) => { rowFilter = filter; return query([{ _id: "s1", env: "a1", typeSignal: "ROSE", symbol: "BTCUSDT", side: "LONG", status: "WIN", profit: 12, roe: 4, openTime: new Date() }]); };
    AccountStatic.countDocuments = async () => 1;
    let aggregateCall = 0;
    AccountStatic.aggregate = async () => ++aggregateCall === 1
        ? [{ profit: 12, roi: 4, volume: 100, wins: 1, losses: 0 }]
        : [{ _id: "ROSE", count: 1, profit: 12 }];
    try {
        const result = await listAccountStatics({ role: "viewer", botUsernames: ["alpha"] }, { username: "alpha", env: "a1" });
        assert.deepEqual(rowFilter.env, { $in: ["a1"] });
        const span = Date.now() - rowFilter.openTime.$gte.getTime();
        assert.ok(span > 2.9 * 24 * 60 * 60 * 1000 && span < 3.1 * 24 * 60 * 60 * 1000);
        assert.equal(result.stats.profit, 12);
        assert.equal(result.stats.winRate, 100);
        assert.equal(result.rows[0].signal, "ROSE");
    } finally {
        UserAccount.findOne = originals.user;
        AccountStatic.find = originals.rows;
        AccountStatic.countDocuments = originals.count;
        AccountStatic.aggregate = originals.aggregate;
    }
});
