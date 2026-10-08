const test = require("node:test");
const assert = require("node:assert/strict");

process.env.WEB_JWT_SECRET = "test-secret-at-least-16-characters";

const UserAccount = require("../src/models/user-account");
const UserApi = require("../src/models/user-api");
const FuturesProfit = require("../src/models/futures-profit");
const AccountStatic = require("../src/models/account-static");
const AuditLog = require("../src/models/audit-log");
const { isOwnUser, assignedUsers, ledgerEnv, summarizeLedger, refreshLedger } = require("../src/lib/account-ledger");

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

test("all-scope static and income include every bot the actor may view", async () => {
    const original = UserAccount.find;
    UserAccount.find = () => chain([
        { username: "HIEN", accounts: ["H"], ownerUserId: "other", visibility: "public", active: true },
        { username: "secret", accounts: ["S"], ownerUserId: "other", visibility: "private", active: true },
        { username: "ZED", accounts: ["Z"], ownerUserId: "other", visibility: "public", active: true },
    ]);
    try {
        const admin = await assignedUsers({ id: "admin", role: "admin", username: "root", botUsernames: [] });
        assert.deepEqual(admin.map((row) => row.username), ["HIEN", "secret", "ZED"]);
        const collaborator = await assignedUsers({ id: "vx", role: "collaborator", username: "vx268", botUsernames: ["HIEN"] });
        assert.deepEqual(collaborator.map((row) => row.username), ["HIEN"]);
    } finally {
        UserAccount.find = original;
    }
});

test("ledger uses the user name as the shared wallet env", () => {
    assert.equal(ledgerEnv({ username: "v", accounts: ["v1", "V"] }), "V");
    assert.equal(ledgerEnv({ username: "vx268", accounts: ["a1"] }), "A1");
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
