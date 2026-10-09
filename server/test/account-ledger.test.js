const test = require("node:test");
const assert = require("node:assert/strict");

process.env.WEB_JWT_SECRET = "test-secret-at-least-16-characters";

const UserAccount = require("../src/models/user-account");
const UserApi = require("../src/models/user-api");
const FuturesProfit = require("../src/models/futures-profit");
const AccountStatic = require("../src/models/account-static");
const AuditLog = require("../src/models/audit-log");
const { isOwnUser, usersForAudience, ledgerEnv, ledgerWindow, summarizeLedger, refreshLedger, audienceUsers, walletTargets, mergeDayRows, loadLedger } = require("../src/lib/account-ledger");

function chain(value) {
    return {
        select() { return this; },
        sort() { return this; },
        lean() { return Promise.resolve(value); },
        then(onOk, onErr) { return Promise.resolve(value).then(onOk, onErr); },
    };
}

test("own user is the owner or an assigned bot, not every visible user", () => {
    const actor = { id: "vx", username: "vx268", email: "vx@x268.com", botUsernames: ["assigned"] };
    assert.equal(isOwnUser(actor, { username: "V", ownerUserId: "vx" }), true);
    assert.equal(isOwnUser(actor, { username: "assigned", ownerUserId: "other" }), true);
    assert.equal(isOwnUser(actor, { username: "other", ownerUserId: "other" }), false);
    assert.equal(isOwnUser(actor, { username: "vx268", ownerUserId: null }), true);
});

test("mine is owned plus assigned, all adds bots the actor may view", async () => {
    const original = UserAccount.find;
    UserAccount.find = () => chain([
        { username: "HIEN", accounts: ["H"], ownerUserId: "other", visibility: "public", active: true },
        { username: "MINE", accounts: ["M"], ownerUserId: "admin", visibility: "public", active: true },
        { username: "SECRET", accounts: ["S"], ownerUserId: "other", visibility: "private", active: true },
        { username: "OLD", accounts: ["O"], ownerUserId: "admin", visibility: "public", active: false },
        { username: "ZED", accounts: ["Z"], ownerUserId: "other", visibility: "public", active: true },
    ]);
    try {
        const admin = { id: "admin", role: "admin", username: "root", botUsernames: ["HIEN"] };
        assert.deepEqual((await usersForAudience(admin, "mine")).map((row) => row.username), ["HIEN", "MINE"]);
        assert.deepEqual((await usersForAudience(admin, "all")).map((row) => row.username), ["HIEN", "MINE", "SECRET", "ZED"]);
        const supervisor = { id: "sup", role: "supervisor", username: "sup", botUsernames: [] };
        assert.deepEqual((await usersForAudience(supervisor, "mine")).map((row) => row.username), []);
        assert.deepEqual((await usersForAudience(supervisor, "all")).map((row) => row.username), ["HIEN", "MINE", "ZED"]);
    } finally {
        UserAccount.find = original;
    }
});

test("a member sees an assigned bot on the ledger", async () => {
    const original = UserAccount.find;
    const originalProfit = FuturesProfit.find;
    const originalStatic = AccountStatic.aggregate;
    UserAccount.find = () => chain([
        { username: "HOA", accounts: ["HOA"], ownerUserId: "other", visibility: "public", active: true },
        { username: "ZED", accounts: ["Z"], ownerUserId: "other", visibility: "public", active: true },
    ]);
    FuturesProfit.find = () => chain([{ env: "HOA", day: new Date("2026-10-09T00:00:00.000Z"), profit: 3, balance: 100 }]);
    AccountStatic.aggregate = async () => [];
    try {
        const apex = { id: "apex", role: "member", username: "apex", botUsernames: ["HOA"] };
        const ledger = await loadLedger(apex, { username: "HOA", days: "14" });
        assert.equal(ledger.username, "HOA");
        assert.deepEqual(ledger.users.map((item) => item.username), ["HOA"]);
        await assert.rejects(() => loadLedger(apex, { username: "ZED" }), (error) => error.status === 404);
    } finally {
        UserAccount.find = original;
        FuturesProfit.find = originalProfit;
        AccountStatic.aggregate = originalStatic;
    }
});

test("ranges cover today, three days, this month, quarter and year", () => {
    const now = new Date("2026-02-15T18:00:00.000Z");
    const day = (value) => ledgerWindow(value, now).from.toISOString().slice(0, 10);
    assert.equal(day("today"), "2026-02-15");
    assert.equal(day("3"), "2026-02-13");
    assert.equal(day("month"), "2026-02-01");
    assert.equal(day("quarter"), "2026-01-01");
    assert.equal(day("year"), "2026-01-01");
    assert.equal(ledgerWindow("nope", now).range, "14");
    assert.equal(ledgerWindow("quarter", new Date("2026-05-10T00:00:00.000Z")).from.toISOString().slice(0, 10), "2026-04-01");
});

test("ledger uses the user name as the shared wallet env", () => {
    assert.equal(ledgerEnv({ username: "v", accounts: ["v1", "V"] }), "V");
    assert.equal(ledgerEnv({ username: "vx268", accounts: ["a1"] }), "A1");
});

test("all view sums each wallet and keeps one row when two users share an env", () => {
    const actor = { id: "vx", username: "vx268", botUsernames: ["B2"] };
    const users = [
        { username: "B1", accounts: ["B1"], active: true, ownerUserId: "vx" },
        { username: "B2", accounts: ["B2"], active: true, ownerUserId: "other" },
        { username: "B3", accounts: ["B1"], active: true, ownerUserId: "vx" },
        { username: "OLD", accounts: ["OLD"], active: false, ownerUserId: "vx" },
    ];
    assert.deepEqual(audienceUsers(users, actor, {}).map((item) => item.username), ["B1", "B2", "B3"]);
    assert.deepEqual(walletTargets(audienceUsers(users, actor, {})).map((item) => item.env), ["B1", "B2"]);
    const merged = mergeDayRows([
        { ymd: "2026-10-08", balance: 100, profit: 5, fee: -1, funding: 0, rebate: 0, trading: 4, cashIn: 10, cashOut: 0, transferIn: 0, transferOut: 0, conversion: 0, unrealized: 1, available: 40, margin: 10, exchangeBalance: 100, dbBalanceBefore: 90, incomeByType: {}, cashEntries: [] },
        { ymd: "2026-10-08", balance: 50, profit: -2, fee: -0.5, funding: 0, rebate: 0, trading: -2.5, cashIn: 0, cashOut: -3, transferIn: 0, transferOut: 0, conversion: 0, unrealized: -1, available: 20, margin: 5, exchangeBalance: 50, dbBalanceBefore: 40, incomeByType: {}, cashEntries: [] },
    ]);
    assert.equal(merged.balance, 150);
    assert.equal(merged.trading, 1.5);
    assert.equal(merged.available, 60);
    assert.equal(merged.unrealized, 0);
    assert.equal(merged.cashIn, 10);
    assert.equal(merged.cashOut, -3);
});

test("stored days separate trading pnl from cash flow", () => {
    const summary = summarizeLedger([
        {
            day: new Date("2026-10-07T00:00:00.000Z"),
            balance: 1000,
            profit: 12,
            fee: -1,
            funding: -0.2,
            ref: 0.1,
            stats: { wallet: { incomeByType: { REALIZED_PNL: 13.1, COMMISSION: -1, FUNDING_FEE: -0.2, FEE_RETURN: 0.1, DEPOSIT: 50, WITHDRAW: -20 } } },
        },
    ], 10);
    assert.equal(summary.days[0].trading, 12);
    assert.equal(summary.days[0].cashIn, 50);
    assert.equal(summary.days[0].cashOut, -20);
    assert.equal(summary.totals.staticProfit, 10);
    assert.equal(summary.totals.staticDiff, 2);
    assert.equal(summary.flows.length, 1);
});

test("refresh stores today's exchange wallet and does not return the API secret", async () => {
    const originalAccount = UserAccount.find;
    const originalApi = UserApi.findOne;
    const originalProfit = FuturesProfit.find;
    const originalOne = FuturesProfit.findOne;
    const originalUpdate = FuturesProfit.findOneAndUpdate;
    const originalStatic = AccountStatic.aggregate;
    const originalAudit = AuditLog.create;
    const saved = [];
    UserAccount.find = () => chain([{ username: "V", accounts: ["V"], ownerUserId: "vx", visibility: "public", active: true }]);
    UserApi.findOne = () => chain({ username: "V", exchange: "binance", api_key: "key-1", api_secret: "secret-1" });
    FuturesProfit.findOne = () => chain(null);
    FuturesProfit.find = () => chain([]);
    FuturesProfit.findOneAndUpdate = async (filter, update) => {
        saved.push({ filter, update });
        return {};
    };
    AccountStatic.aggregate = async () => [{ profit: 0 }];
    AuditLog.create = async () => ({});
    const fetchImpl = async (url) => {
        assert.equal(String(url).includes("secret-1"), false);
        const path = String(url);
        let body = [];
        if (path.includes("/fapi/v2/account")) body = { totalWalletBalance: "1200.5", availableBalance: "800", totalUnrealizedProfit: "-15", totalInitialMargin: "400" };
        else if (path.includes("/fapi/v2/balance")) body = [{ asset: "USDT", balance: "1200.5", crossUnPnl: "-15" }];
        else if (path.includes("/fapi/v1/ticker/price")) body = [];
        else if (path.includes("/fapi/v1/income")) body = [{ incomeType: "REALIZED_PNL", income: "5", asset: "USDT", time: Date.now() }, { incomeType: "DEPOSIT", income: "100", asset: "USDT", time: Date.now() }];
        return { ok: true, status: 200, json: async () => body };
    };
    try {
        const result = await refreshLedger({ id: "vx", role: "supervisor" }, "V", { fetchImpl, days: 14 });
        assert.equal(saved.length, 1);
        assert.equal(saved[0].update.$set.balance, 1200.5);
        assert.equal(saved[0].update.$set.stats.wallet.available, 800);
        assert.equal(saved[0].update.$set.stats.wallet.margin, 400);
        assert.equal(saved[0].update.$set.stats.wallet.unPnlNow, -15);
        assert.equal(JSON.stringify(result).includes("secret-1"), false);
        assert.equal(JSON.stringify(result).includes("key-1"), false);
    } finally {
        UserAccount.find = originalAccount;
        UserApi.findOne = originalApi;
        FuturesProfit.find = originalProfit;
        FuturesProfit.findOne = originalOne;
        FuturesProfit.findOneAndUpdate = originalUpdate;
        AccountStatic.aggregate = originalStatic;
        AuditLog.create = originalAudit;
    }
});
