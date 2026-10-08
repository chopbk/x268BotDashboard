const test = require("node:test");
const assert = require("node:assert/strict");
process.env.WEB_JWT_SECRET = "test-secret-at-least-16-characters";

const UserAccount = require("../src/models/user-account");
const AccountConfig = require("../src/models/account-config");
const AccountStatic = require("../src/models/account-static");
const FuturesSymbol = require("../src/models/futures-symbol");
const { decimalsFromStep } = require("../src/lib/symbol-info");
const { listAccountStatics, getAccountStatic } = require("../src/lib/account-statics");

function query(value) {
    return { select() { return this; }, sort() { return this; }, skip() { return this; }, limit() { return this; }, lean() { return Promise.resolve(value); }, then(ok, fail) { return Promise.resolve(value).then(ok, fail); } };
}

test("Account Static is scoped to the selected config and returns profit statistics", async () => {
    const originals = { user: UserAccount.findOne, rows: AccountStatic.find, count: AccountStatic.countDocuments, aggregate: AccountStatic.aggregate, configs: AccountConfig.find };
    let rowFilter;
    UserAccount.findOne = () => query({ username: "alpha", accounts: ["a1", "a2"], visibility: "public" });
    AccountConfig.find = () => query([]);
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
        AccountConfig.find = originals.configs;
    }
});

test("Account Static filters signal, status and profit without narrowing the signal breakdown", async () => {
    const originals = { user: UserAccount.findOne, rows: AccountStatic.find, count: AccountStatic.countDocuments, aggregate: AccountStatic.aggregate, configs: AccountConfig.find };
    let rowFilter;
    let scope;
    let facet;
    UserAccount.findOne = () => query({ username: "alpha", accounts: ["a1"], visibility: "public" });
    AccountConfig.find = () => query([]);
    AccountStatic.find = (filter) => { rowFilter = filter; return query([]); };
    AccountStatic.countDocuments = async () => 0;
    AccountStatic.aggregate = async (pipeline) => {
        if (pipeline[1]?.$facet) {
            scope = pipeline[0].$match;
            facet = pipeline[1].$facet;
        }
        return pipeline[1]?.$facet
            ? [{ bySignal: [], byConfig: [{ _id: "a1", count: 12, wins: 9, profit: 8, cost: 40 }], byStatus: [] }]
            : [{ profit: 0, roi: 0, volume: 0, wins: 0, losses: 0 }];
    };
    try {
        const result = await listAccountStatics({ role: "viewer", botUsernames: ["alpha"] }, { username: "alpha", signal: "signal_a+", status: "win", profit: "loss" });
        assert.equal(rowFilter.typeSignal.source, "^signal_a\\+$");
        assert.equal(rowFilter.status, "WIN");
        assert.deepEqual(rowFilter.profit, { $lt: 0 });
        assert.equal(scope.typeSignal, undefined);
        assert.equal(scope.status, undefined);
        assert.equal(scope.profit, undefined);
        assert.equal(facet.byConfig[0].$match.typeSignal.source, "^signal_a\\+$");
        assert.deepEqual(facet.byConfigSignal[0].$group._id, { env: "$env", signal: "$typeSignal" });
        assert.equal(result.stats.bySignal.length, 0);
        assert.equal(result.stats.byConfig[0].env, "a1");
        assert.equal(result.stats.byConfig[0].winRate, 75);
    } finally {
        UserAccount.findOne = originals.user;
        AccountStatic.find = originals.rows;
        AccountStatic.countDocuments = originals.count;
        AccountStatic.aggregate = originals.aggregate;
        AccountConfig.find = originals.configs;
    }
});

test("Account Static defaults to live trades and compares signals by profit, win rate and side", async () => {
    const originals = { user: UserAccount.findOne, rows: AccountStatic.find, count: AccountStatic.countDocuments, aggregate: AccountStatic.aggregate, configs: AccountConfig.find };
    let rowFilter;
    UserAccount.findOne = () => query({ username: "alpha", accounts: ["a1", "a2"], visibility: "public" });
    AccountConfig.find = () => query([]);
    AccountStatic.find = (filter) => { rowFilter = filter; return query([]); };
    AccountStatic.countDocuments = async () => 4;
    AccountStatic.aggregate = async (pipeline) => (pipeline[1]?.$facet
        ? [{
            bySignal: [{ _id: "SIGNAL_A", count: 4, wins: 3, losses: 1, profit: 30, cost: 100, volume: 400, roi: 40, winRoe: 60, lossRoe: -10, maxProfit: 20, minProfit: -5, longCount: 3, shortCount: 1, longProfit: 28, shortProfit: 2 }],
            byEnv: [{ _id: "a1", count: 4, wins: 3, losses: 1, profit: 30, cost: 100 }],
            bySide: [{ _id: "LONG", count: 3, wins: 2, losses: 1, profit: 28, cost: 80 }],
            byStatus: [],
        }]
        : [{ profit: 30, cost: 100, wins: 3, losses: 1, volume: 400, roi: 40, longProfit: 28, shortProfit: 2 }]);
    try {
        const result = await listAccountStatics({ role: "viewer", botUsernames: ["alpha"] }, { username: "alpha" });
        assert.deepEqual(rowFilter.isPaper, { $ne: true });
        assert.equal(result.stats.avgRoi, 30);
        assert.equal(result.stats.longProfit, 28);
        const signal = result.stats.bySignal[0];
        assert.equal(signal.signal, "SIGNAL_A");
        assert.equal(signal.winRate, 75);
        assert.equal(signal.avgRoi, 30);
        assert.equal(signal.avgWinRoe, 20);
        assert.equal(signal.longCount, 3);
        assert.equal(signal.shortProfit, 2);
        assert.equal(result.stats.byEnv[0].env, "a1");
        assert.equal(result.stats.bySide[0].side, "LONG");

        await listAccountStatics({ role: "viewer", botUsernames: ["alpha"] }, { username: "alpha", book: "paper", copy: "copy", closed: "open" });
        assert.equal(rowFilter.isPaper, true);
        assert.equal(rowFilter.isCopy, true);
        assert.deepEqual(rowFilter.isClosed, { $ne: true });
    } finally {
        UserAccount.findOne = originals.user;
        AccountStatic.find = originals.rows;
        AccountStatic.countDocuments = originals.count;
        AccountStatic.aggregate = originals.aggregate;
        AccountConfig.find = originals.configs;
    }
});

test("a paper user opens on the paper book unless live is requested", async () => {
    const originals = { user: UserAccount.findOne, rows: AccountStatic.find, count: AccountStatic.countDocuments, aggregate: AccountStatic.aggregate, configs: AccountConfig.find };
    let rowFilter;
    UserAccount.findOne = () => query({ username: "PAPER", accounts: ["PAPER", "PAPER1"], visibility: "public" });
    AccountConfig.find = () => query([
        { env: "PAPER", trade_config: { PAPER: true } },
        { env: "PAPER1", trade_config: { PAPER: true } },
    ]);
    AccountStatic.find = (filter) => { rowFilter = filter; return query([]); };
    AccountStatic.countDocuments = async () => 0;
    AccountStatic.aggregate = async () => [{ profit: 0, wins: 0, losses: 0 }];
    try {
        const opened = await listAccountStatics({ role: "viewer", botUsernames: ["PAPER"] }, { username: "PAPER" });
        assert.equal(opened.book, "paper");
        assert.equal(rowFilter.isPaper, true);
        const forced = await listAccountStatics({ role: "viewer", botUsernames: ["PAPER"] }, { username: "PAPER", book: "live" });
        assert.equal(forced.book, "live");
        assert.deepEqual(rowFilter.isPaper, { $ne: true });
    } finally {
        UserAccount.findOne = originals.user;
        AccountStatic.find = originals.rows;
        AccountStatic.countDocuments = originals.count;
        AccountStatic.aggregate = originals.aggregate;
        AccountConfig.find = originals.configs;
    }
});

test("Account Static detail stays inside the selected bot", async () => {
    const originals = { user: UserAccount.findOne, one: AccountStatic.findOne, symbols: FuturesSymbol.find };
    let detailFilter;
    UserAccount.findOne = () => query({ username: "alpha", accounts: ["a1"], visibility: "public" });
    AccountStatic.findOne = (filter) => { detailFilter = filter; return query({ _id: "a".repeat(24), env: "a1", typeSignal: "SIGNAL_A", symbol: "BTCUSDT", side: "LONG", status: "WIN", profit: 3, tps: [1, 2], positionAmt: 0.1, isCopy: true }); };
    FuturesSymbol.find = () => query([]);
    try {
        await assert.rejects(() => getAccountStatic({ role: "viewer", botUsernames: ["alpha"] }, "nope", { username: "alpha" }), /Mã giao dịch không hợp lệ/);
        const row = await getAccountStatic({ role: "viewer", botUsernames: ["alpha"] }, "a".repeat(24), { username: "alpha" });
        assert.deepEqual(detailFilter.env, { $in: ["a1"] });
        assert.equal(row.signal, "SIGNAL_A");
        assert.deepEqual(row.tps, [1, 2]);
        assert.equal(row.copy, true);
        assert.equal(row.positionAmt, 0.1);
        assert.equal(row.symbolInfo, null);
    } finally {
        UserAccount.findOne = originals.user;
        AccountStatic.findOne = originals.one;
        FuturesSymbol.find = originals.symbols;
    }
});

test("Account Static detail uses Futures_symbols tick size and omits market info", async () => {
    const originals = { user: UserAccount.findOne, one: AccountStatic.findOne, symbols: FuturesSymbol.find };
    UserAccount.findOne = () => query({ username: "alpha", accounts: ["a1"], visibility: "public" });
    AccountStatic.findOne = () => query({
        _id: "b".repeat(24),
        env: "a1",
        symbol: "1000PEPEUSDT",
        entryPrice: 0.00001234,
        closePrice: 0.000013,
        tps: [0.000014],
    });
    FuturesSymbol.find = (filter) => query([
        { symbol: "PEPEUSDT", exchange: "bybit", tickSize: 0.0001, stepSize: 1, marketInfo: { secret: true } },
        { symbol: "1000PEPEUSDT", exchange: "binance", tickSize: 0.0000001, stepSize: 1, marketInfo: { cap: 1 } },
    ].filter((row) => filter.symbol.$in.includes(row.symbol)));
    try {
        assert.equal(decimalsFromStep(0.01), 2);
        assert.equal(decimalsFromStep(0.0000001), 7);
        assert.equal(decimalsFromStep(1), 0);
        const row = await getAccountStatic({ role: "viewer", botUsernames: ["alpha"] }, "b".repeat(24), { username: "alpha" });
        assert.equal(row.symbolInfo.symbol, "1000PEPEUSDT");
        assert.equal(row.symbolInfo.exchange, "binance");
        assert.equal(row.symbolInfo.priceDecimals, 7);
        assert.equal(row.symbolInfo.tickSize, 0.0000001);
        assert.equal(JSON.stringify(row.symbolInfo).includes("marketInfo"), false);
        assert.equal(JSON.stringify(row.symbolInfo).includes("secret"), false);
    } finally {
        UserAccount.findOne = originals.user;
        AccountStatic.findOne = originals.one;
        FuturesSymbol.find = originals.symbols;
    }
});
