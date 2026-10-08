const test = require("node:test");
const assert = require("node:assert/strict");

process.env.WEB_JWT_SECRET = "test-secret-at-least-16-characters";

const UserAccount = require("../src/models/user-account");
const AccountConfig = require("../src/models/account-config");
const AccountStatic = require("../src/models/account-static");
const FuturesProfit = require("../src/models/futures-profit");
const UserApi = require("../src/models/user-api");
const RuntimeLog = require("../src/models/runtime-log");
const { getDashboard } = require("../src/lib/dashboard");

const operator = { id: "op", role: "admin", username: "op", email: "op@x.com", botUsernames: ["V"] };

function query(value) {
    return {
        select() { return this; },
        sort() { return this; },
        limit() { return this; },
        lean() { return Promise.resolve(value); },
    };
}

test("dashboard stays on owned or assigned bots and hides secrets", async () => {
    const originals = {
        users: UserAccount.find,
        configs: AccountConfig.find,
        statics: AccountStatic.aggregate,
        profits: FuturesProfit.aggregate,
        apis: UserApi.aggregate,
        logs: RuntimeLog.find,
        aggregate: RuntimeLog.aggregate,
    };
    UserAccount.find = () => query([
        { username: "V", accounts: ["V1", "V2"], ownerUserId: "other", active: true },
        { username: "OTHER", accounts: ["O1"], ownerUserId: "other", active: true },
    ]);
    AccountConfig.find = (filter) => query([
        { env: "V1", signals: ["ROSE"], trade_config: { ON: true } },
        { env: "V2", signals: [], trade_config: { ON: true } },
        { env: "O1", signals: ["BULL"], trade_config: { ON: true } },
    ].filter((doc) => !filter?.env?.$in || filter.env.$in.includes(doc.env)));
    AccountStatic.aggregate = async () => [{ _id: "V1", profit: 12 }, { _id: "O1", profit: 99 }];
    FuturesProfit.aggregate = async () => [{ profit: 3 }];
    UserApi.aggregate = async () => [{ username: "V", hasApiKey: false, api_key: "secret-key" }];
    const logs = [
        { at: new Date(), env: "V2", signal: "ROSE", message: "NOT OPEN ROSE blacklist", source: "callHandleSignalBot" },
        { at: new Date(), env: "O1", signal: "BULL", message: "NOT OPEN BULL", source: "callHandleSignalBot" },
        { at: new Date(), env: "V1", signal: "ROSE", message: "gỡ ROSE", source: "autoremove" },
    ];
    RuntimeLog.find = (match) => query(logs.filter((row) => row.source === match.source && (!match.env?.$in || match.env.$in.includes(row.env))));
    RuntimeLog.aggregate = async (pipeline) => {
        const signal = pipeline[0].$match.signal?.$in || [];
        return signal.includes("ROSE") ? [{ _id: "ROSE", count: 2 }] : [{ _id: "BULL", count: 9 }];
    };
    try {
        const view = await getDashboard(operator, new Date("2026-10-08T12:00:00Z"));
        assert.equal(view.bots.total, 1);
        assert.equal(view.bots.active, 1);
        assert.equal(view.configs.on, 2);
        assert.equal(view.profitToday, 12);
        assert.equal(view.incomeToday, 3);
        assert.deepEqual(view.mine.map((row) => row.username), ["V"]);
        assert.equal(view.mine[0].on, 2);
        assert.equal(JSON.stringify(view).includes("secret-key"), false);
        assert.equal(JSON.stringify(view).includes("BULL"), false);
        assert.equal(JSON.stringify(view).includes("OTHER"), false);
        assert.equal(view.attention.some((item) => item.type === "api"), true);
        assert.equal(view.attention.some((item) => item.type === "config" && item.title.includes("V2")), true);
        assert.equal(view.attention.some((item) => item.type === "blocked" && item.title.includes("V2")), true);
        assert.equal(view.attention.some((item) => item.type === "parse"), true);
        assert.equal(view.attention.some((item) => item.type === "removed"), true);
    } finally {
        UserAccount.find = originals.users;
        AccountConfig.find = originals.configs;
        AccountStatic.aggregate = originals.statics;
        FuturesProfit.aggregate = originals.profits;
        UserApi.aggregate = originals.apis;
        RuntimeLog.find = originals.logs;
        RuntimeLog.aggregate = originals.aggregate;
    }
});
