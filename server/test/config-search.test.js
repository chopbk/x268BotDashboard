const test = require("node:test");
const assert = require("node:assert/strict");

process.env.WEB_JWT_SECRET = "test-secret-at-least-16-characters";

const UserAccount = require("../src/models/user-account");
const AccountConfig = require("../src/models/account-config");
const AccountStatic = require("../src/models/account-static");
const { searchConfigsBySignal } = require("../src/lib/config-search");

function query(value) {
    return {
        select() {
            return this;
        },
        lean() {
            return Promise.resolve(value);
        },
    };
}

const supervisor = { role: "supervisor", id: "me", botUsernames: [], permissionScopes: {} };

test("searchConfigsBySignal keeps viewable configs and sorts by the latest trade", async () => {
    const originalUsers = UserAccount.find;
    const originalConfigs = AccountConfig.find;
    const originalStats = AccountStatic.aggregate;
    const older = new Date("2026-10-01T00:00:00.000Z");
    const newer = new Date("2026-10-06T00:00:00.000Z");
    UserAccount.find = () => query([
        { username: "mine", ownerUserId: "me", visibility: "private", active: true, accounts: ["m1"] },
        { username: "open", ownerUserId: "other", visibility: "public", active: true, accounts: ["o1"] },
        { username: "secret", ownerUserId: "other", visibility: "private", active: true, accounts: ["s1"] },
        { username: "idle", ownerUserId: "other", visibility: "public", active: true, accounts: ["i1"] },
    ]);
    AccountConfig.find = () => query([
        { env: "m1", signals: ["rose"], trade_config: { ON: true, LONG: true, FIX_COST_AMOUNT: 10, LONG_LEVERAGE: 5, MARGIN: { MODE: "FIX" }, OPEN: { TYPE: "LIMIT" }, TP: { TYPE: "FIX", PERCENT: [0.2, 0.4] }, SL: { TYPE: "MARKET", SL_PERCENT: -0.3 }, TRAILING: { ON: true, TYPE: "FIX", SP_PERCENT: 0.01, TRIGGER_PERCENT: 0.05 } } },
        { env: "o1", signals: ["BULL", "ROSE"] },
        { env: "s1", signals: ["ROSE"] },
        { env: "i1", signals: ["ROSE"] },
    ]);
    AccountStatic.aggregate = async () => [
        { _id: "m1", trades: 2, profit: 10, wins: 1, lastTime: older },
        { _id: "o1", trades: 4, profit: -3, wins: 1, lastTime: newer },
    ];
    try {
        const result = await searchConfigsBySignal(supervisor, { signal: "rose, missing", days: 30 });
        assert.deepEqual(result.rows.map((row) => row.env), ["o1", "m1"]);
        assert.equal(result.rows[0].canEdit, false);
        assert.equal(result.rows[1].canEdit, true);
        assert.equal(result.rows[0].trades, 4);
        assert.equal(result.rows[1].winRate, 50);
        assert.deepEqual(result.rows[0].matched, ["ROSE"]);
        assert.equal(result.rows.some((row) => row.env === "i1" || row.trades === 0), false);
        assert.equal(result.rows[1].config.volume, 50);
        assert.equal(result.rows[1].config.mode, "FIX");
        assert.deepEqual(result.rows[1].config.tp, [0.2, 0.4]);
        assert.equal(result.rows[1].config.sl, -0.3);
        assert.equal(result.rows[1].config.trailing, true);
        assert.equal(result.rows[1].config.sp, 0.01);
        const filtered = await searchConfigsBySignal(supervisor, { signal: "ROSE", days: 30, minWinRate: 40, profit: 0, profitOp: "gt" });
        assert.deepEqual(filtered.rows.map((row) => row.env), ["m1"]);
    } finally {
        UserAccount.find = originalUsers;
        AccountConfig.find = originalConfigs;
        AccountStatic.aggregate = originalStats;
    }
});
