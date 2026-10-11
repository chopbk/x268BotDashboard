const test = require("node:test");
const assert = require("node:assert/strict");

process.env.WEB_JWT_SECRET = "test-secret-at-least-16-characters";

const SignalInfo = require("../src/models/signal-info");
const AccountStatic = require("../src/models/account-static");
const TelegramClient = require("../src/models/telegram-client");
const accountLedger = require("../src/lib/account-ledger");
const { listProviderScorecard } = require("../src/lib/provider-scorecard");

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

test("listProviderScorecard ranks channel by trades and feed", async () => {
    const originals = {
        feed: SignalInfo.aggregate,
        trades: AccountStatic.aggregate,
        channels: TelegramClient.find,
        users: accountLedger.usersForAudience,
    };
    SignalInfo.aggregate = async () => [
        { _id: "SIGNAL_A", feed: 5, feedLong: 3, feedShort: 2 },
        { _id: "BULL", feed: 2, feedLong: 1, feedShort: 1 },
    ];
    AccountStatic.aggregate = async () => [
        {
            _id: "SIGNAL_A",
            trades: 4,
            wins: 3,
            losses: 1,
            profit: 12.5,
            volume: 400,
            cost: 100,
            longCount: 3,
            shortCount: 1,
            longProfit: 10,
            shortProfit: 2.5,
            envs: ["a1", "a2"],
        },
        {
            _id: "BULL",
            trades: 2,
            wins: 0,
            losses: 2,
            profit: -8,
            volume: 200,
            cost: 80,
            longCount: 1,
            shortCount: 1,
            longProfit: -3,
            shortProfit: -5,
            envs: ["a1"],
        },
    ];
    TelegramClient.find = () => query([{ channels: [{ name: "signal_a" }, { name: "OTHER" }] }]);
    accountLedger.usersForAudience = async () => [
        { username: "alpha", accounts: ["a1", "a2"] },
    ];
    try {
        const actor = {
            id: "u1",
            role: "viewer",
            botUsernames: ["alpha"],
            permissionScopes: { "statistics.view": "own", "signals.history": "all" },
        };
        const result = await listProviderScorecard(actor, { scope: "mine", book: "live", sort: "profit" });
        assert.equal(result.canSeeFeed, true);
        assert.equal(result.canSeeTrades, true);
        assert.deepEqual(result.rows.map((row) => row.signal), ["SIGNAL_A", "BULL"]);
        assert.equal(result.rows[0].channel, true);
        assert.equal(result.rows[0].feed, 5);
        assert.equal(result.rows[0].trades, 4);
        assert.equal(result.rows[0].winRate, 75);
        assert.equal(result.rows[0].configs, 2);
        assert.equal(result.rows[0].accounts, 1);
        assert.equal(result.rows[1].channel, false);
        assert.equal(result.summary.providers, 2);
        assert.equal(result.summary.feed, 7);
        const filtered = await listProviderScorecard(actor, { minTrades: 3, sort: "feed" });
        assert.deepEqual(filtered.rows.map((row) => row.signal), ["SIGNAL_A"]);
    } finally {
        SignalInfo.aggregate = originals.feed;
        AccountStatic.aggregate = originals.trades;
        TelegramClient.find = originals.channels;
        accountLedger.usersForAudience = originals.users;
    }
});

test("listProviderScorecard feed-only when missing statistics.view", async () => {
    const originals = {
        feed: SignalInfo.aggregate,
        trades: AccountStatic.aggregate,
        channels: TelegramClient.find,
        users: accountLedger.usersForAudience,
    };
    SignalInfo.aggregate = async () => [{ _id: "ROSE", feed: 3, feedLong: 2, feedShort: 1 }];
    AccountStatic.aggregate = async () => {
        throw new Error("trades must not run");
    };
    TelegramClient.find = () => query([]);
    accountLedger.usersForAudience = async () => {
        throw new Error("users must not run");
    };
    try {
        const actor = {
            id: "u2",
            role: "member",
            customPermissions: ["signals.history"],
            botUsernames: [],
            permissionScopes: { "signals.history": "all" },
        };
        const result = await listProviderScorecard(actor, {});
        assert.equal(result.canSeeFeed, true);
        assert.equal(result.canSeeTrades, false);
        assert.equal(result.rows[0].signal, "ROSE");
        assert.equal(result.rows[0].trades, 0);
        assert.equal(result.rows[0].feed, 3);
    } finally {
        SignalInfo.aggregate = originals.feed;
        AccountStatic.aggregate = originals.trades;
        TelegramClient.find = originals.channels;
        accountLedger.usersForAudience = originals.users;
    }
});
