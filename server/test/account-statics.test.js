const test = require("node:test");
const assert = require("node:assert/strict");
process.env.WEB_JWT_SECRET = "test-secret-at-least-16-characters";

const UserAccount = require("../src/models/user-account");
const AccountConfig = require("../src/models/account-config");
const AccountStatic = require("../src/models/account-static");
const FuturesProfit = require("../src/models/futures-profit");
const FuturesSymbol = require("../src/models/futures-symbol");
const { decimalsFromStep } = require("../src/lib/symbol-info");
const {
    listAccountStatics,
    getAccountStatic,
    longestLosingStreak,
    buildInsights,
    fillSeries,
    presentGroup,
} = require("../src/lib/account-statics");

function query(value) {
    return { select() { return this; }, sort() { return this; }, skip() { return this; }, limit() { return this; }, lean() { return Promise.resolve(value); }, then(ok, fail) { return Promise.resolve(value).then(ok, fail); } };
}

function flattenMatch(filter) {
    if (!filter || typeof filter !== "object") return {};
    if (!filter.$and) return filter;
    const { $and, ...rest } = filter;
    return ($and || []).reduce((acc, part) => ({ ...acc, ...flattenMatch(part) }), { ...rest });
}

function totalsRow(overrides = {}) {
    return {
        count: 1,
        valid: 1,
        missingProfit: 0,
        profit: 12,
        grossWin: 12,
        grossLoss: 0,
        cost: 40,
        volume: 100,
        wins: 1,
        losses: 0,
        flats: 0,
        maxProfit: 12,
        minProfit: 12,
        longCount: 1,
        shortCount: 0,
        longProfit: 12,
        shortProfit: 0,
        holdSum: 3600000,
        holdCount: 1,
        ...overrides,
    };
}

test("Account Static is scoped to the selected config and returns profit statistics", async () => {
    const originals = { user: UserAccount.findOne, rows: AccountStatic.find, count: AccountStatic.countDocuments, aggregate: AccountStatic.aggregate, configs: AccountConfig.find };
    let rowFilter;
    UserAccount.findOne = () => query({ username: "alpha", accounts: ["a1", "a2"], visibility: "public" });
    AccountConfig.find = () => query([]);
    AccountStatic.find = (filter) => { rowFilter = filter; return query([{ _id: "s1", env: "a1", typeSignal: "SIGNAL_A", symbol: "BTCUSDT", side: "LONG", status: "WIN", profit: 12, roe: 4, openTime: new Date(), closeTime: new Date() }]); };
    AccountStatic.countDocuments = async () => 1;
    AccountStatic.aggregate = async (pipeline) => {
        if (pipeline[1]?.$facet) {
            return [{ bySignal: [{ _id: "SIGNAL_A", ...totalsRow() }], byStatus: [{ _id: "WIN", count: 1, profit: 12 }] }];
        }
        if (pipeline.some((stage) => stage.$group?._id?.$dateToString)) {
            return [{ _id: "2026-10-01", count: 1, profit: 12 }];
        }
        return [totalsRow()];
    };
    try {
        const result = await listAccountStatics({ role: "viewer", botUsernames: ["alpha"] }, { username: "alpha", env: "a1" });
        const flat = flattenMatch(rowFilter);
        assert.deepEqual(flat.env, { $in: ["a1"] });
        const span = Date.now() - flat.openTime.$gte.getTime();
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

test("Account Static filters signal, status and profit on list and shared aggregates", async () => {
    const originals = { user: UserAccount.findOne, rows: AccountStatic.find, count: AccountStatic.countDocuments, aggregate: AccountStatic.aggregate, configs: AccountConfig.find };
    let rowFilter;
    let match;
    UserAccount.findOne = () => query({ username: "alpha", accounts: ["a1"], visibility: "public" });
    AccountConfig.find = () => query([]);
    AccountStatic.find = (filter) => { rowFilter = filter; return query([]); };
    AccountStatic.countDocuments = async () => 0;
    AccountStatic.aggregate = async (pipeline) => {
        if (pipeline[1]?.$facet) {
            match = pipeline[0].$match;
            return [{ bySignal: [], byConfig: [{ _id: "a1", ...totalsRow({ count: 12, valid: 12, wins: 9, losses: 3, flats: 0, profit: 8, cost: 40, grossWin: 20, grossLoss: -12 }) }], byStatus: [] }];
        }
        if (pipeline.some((stage) => stage.$group?._id?.$dateToString)) return [];
        return [totalsRow({ count: 0, valid: 0, wins: 0, profit: 0 })];
    };
    try {
        const result = await listAccountStatics({ role: "viewer", botUsernames: ["alpha"] }, { username: "alpha", signal: "signal_a+", status: "win", profit: "loss" });
        const flat = flattenMatch(rowFilter);
        const flatMatch = flattenMatch(match);
        assert.equal(flat.typeSignal.source, "^signal_a\\+$");
        assert.equal(flat.status, "WIN");
        assert.deepEqual(flat.profit, { $lt: 0 });
        assert.equal(flatMatch.typeSignal.source, "^signal_a\\+$");
        assert.equal(flatMatch.status, "WIN");
        assert.deepEqual(flatMatch.profit, { $lt: 0 });
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

test("Account Static defaults to live trades and compares signals by profit-based win rate", async () => {
    const originals = { user: UserAccount.findOne, rows: AccountStatic.find, count: AccountStatic.countDocuments, aggregate: AccountStatic.aggregate, configs: AccountConfig.find };
    let rowFilter;
    UserAccount.findOne = () => query({ username: "alpha", accounts: ["a1", "a2"], visibility: "public" });
    AccountConfig.find = () => query([]);
    AccountStatic.find = (filter) => { rowFilter = filter; return query([]); };
    AccountStatic.countDocuments = async () => 4;
    AccountStatic.aggregate = async (pipeline) => {
        if (pipeline[1]?.$facet) {
            return [{
                bySignal: [{ _id: "SIGNAL_A", ...totalsRow({ count: 4, valid: 4, wins: 3, losses: 1, flats: 0, profit: 30, cost: 100, volume: 400, grossWin: 40, grossLoss: -10, maxProfit: 20, minProfit: -5, longCount: 3, shortCount: 1, longProfit: 28, shortProfit: 2 }) }],
                byEnv: [{ _id: "a1", ...totalsRow({ count: 4, valid: 4, wins: 3, losses: 1, profit: 30, cost: 100 }) }],
                bySide: [{ _id: "LONG", ...totalsRow({ count: 3, valid: 3, wins: 2, losses: 1, profit: 28, cost: 80 }) }],
                byStatus: [],
            }];
        }
        if (pipeline.some((stage) => stage.$group?._id?.$dateToString)) return [];
        return [totalsRow({ count: 4, valid: 4, wins: 3, losses: 1, profit: 30, cost: 100, volume: 400, grossWin: 40, grossLoss: -10, longProfit: 28, shortProfit: 2 })];
    };
    try {
        const result = await listAccountStatics({ role: "viewer", botUsernames: ["alpha"] }, { username: "alpha" });
        assert.deepEqual(flattenMatch(rowFilter).isPaper, { $ne: true });
        assert.equal(result.stats.pnlOverCost, 30);
        assert.equal(result.stats.longProfit, 28);
        assert.equal(result.stats.profitFactor, 4);
        const signal = result.stats.bySignal[0];
        assert.equal(signal.signal, "SIGNAL_A");
        assert.equal(signal.winRate, 75);
        assert.equal(signal.pnlOverCost, 30);
        assert.equal(signal.longCount, 3);
        assert.equal(signal.shortProfit, 2);
        assert.equal(result.stats.byEnv[0].env, "a1");
        assert.equal(result.stats.bySide[0].side, "LONG");

        await listAccountStatics({ role: "viewer", botUsernames: ["alpha"] }, { username: "alpha", book: "paper", copy: "copy", closed: "open" });
        const openFlat = flattenMatch(rowFilter);
        assert.equal(openFlat.isPaper, true);
        assert.equal(openFlat.isCopy, true);
        assert.deepEqual(openFlat.isClosed, { $ne: true });
    } finally {
        UserAccount.findOne = originals.user;
        AccountStatic.find = originals.rows;
        AccountStatic.countDocuments = originals.count;
        AccountStatic.aggregate = originals.aggregate;
        AccountConfig.find = originals.configs;
    }
});

test("analytics mode filters by closeTime, defaults closed live, and keeps listDay off aggregates", async () => {
    const originals = { user: UserAccount.findOne, rows: AccountStatic.find, count: AccountStatic.countDocuments, aggregate: AccountStatic.aggregate, configs: AccountConfig.find };
    let listFilter;
    let streakFilter;
    let aggregateMatch;
    UserAccount.findOne = () => query({ username: "alpha", accounts: ["a1"], visibility: "public" });
    AccountConfig.find = () => query([]);
    AccountStatic.find = (filter) => {
        if (Array.isArray(filter.$and) && filter.$and.length >= 2 && filter.$and.some((part) => part.closeTime && !part.env && !part.$or)) {
            listFilter = filter;
        } else {
            streakFilter = filter;
        }
        return query([]);
    };
    AccountStatic.countDocuments = async (filter) => (filter.$or ? 2 : 0);
    AccountStatic.aggregate = async (pipeline) => {
        if (pipeline[0]?.$match && !aggregateMatch) aggregateMatch = pipeline[0].$match;
        if (pipeline[1]?.$facet) return [{ bySignal: [], byConfig: [], bySide: [], byStatus: [] }];
        if (pipeline.some((stage) => stage.$group?._id?.$dateToString)) return [];
        return [totalsRow({ count: 0, valid: 0, wins: 0, profit: 0 })];
    };
    try {
        const result = await listAccountStatics(
            { role: "viewer", botUsernames: ["alpha"] },
            { username: "alpha", analytics: "1", range: "7", listDay: "2026-10-01" }
        );
        const listText = JSON.stringify(listFilter);
        const streakText = JSON.stringify(streakFilter);
        const aggText = JSON.stringify(aggregateMatch);
        assert.match(listText, /"closeTime"/);
        assert.match(listText, /"isClosed":true/);
        assert.match(listText, /2026-10-01/);
        assert.match(listText, /"isPaper"/);
        assert.match(streakText, /"closeTime"/);
        assert.doesNotMatch(streakText, /2026-10-01T23:59:59/);
        assert.equal(aggregateMatch.listDay, undefined);
        assert.match(aggText, /"closeTime"/);
        assert.match(aggText, /"isClosed":true/);
        assert.equal(result.timeField, "closeTime");
        assert.equal(result.book, "live");
        assert.equal(result.stats.excludedMissingClose, 2);
        assert.equal(result.listDay, "2026-10-01");
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
    AccountStatic.aggregate = async () => [totalsRow({ count: 0, valid: 0, wins: 0, profit: 0 })];
    try {
        const opened = await listAccountStatics({ role: "viewer", botUsernames: ["PAPER"] }, { username: "PAPER" });
        assert.equal(opened.book, "paper");
        assert.equal(flattenMatch(rowFilter).isPaper, true);
        const forced = await listAccountStatics({ role: "viewer", botUsernames: ["PAPER"] }, { username: "PAPER", book: "live" });
        assert.equal(forced.book, "live");
        assert.deepEqual(flattenMatch(rowFilter).isPaper, { $ne: true });
    } finally {
        UserAccount.findOne = originals.user;
        AccountStatic.find = originals.rows;
        AccountStatic.countDocuments = originals.count;
        AccountStatic.aggregate = originals.aggregate;
        AccountConfig.find = originals.configs;
    }
});

test("profit factor label and missing profit stay null instead of zero", () => {
    const allWins = presentGroup(totalsRow({ wins: 3, losses: 0, flats: 0, valid: 3, grossWin: 9, grossLoss: 0, profit: 9 }), "signal");
    assert.equal(allWins.profitFactor, null);
    assert.equal(allWins.profitFactorLabel, "Không có lệnh lỗ");
    const empty = presentGroup({ count: 0, valid: 0, wins: 0, losses: 0, flats: 0 }, "signal");
    assert.equal(empty.profit, null);
    assert.equal(empty.winRate, null);
});

test("longest losing streak follows close order and insights stay rule-based", () => {
    assert.equal(longestLosingStreak([{ profit: 1 }, { profit: -1 }, { profit: -2 }, { profit: -3 }, { profit: 4 }, { profit: -1 }]), 3);
    const series = fillSeries(new Date("2026-10-01T00:00:00Z"), new Date("2026-10-03T00:00:00Z"), [
        { day: "2026-10-01", count: 2, profit: 5 },
        { day: "2026-10-03", count: 1, profit: -2 },
    ]);
    assert.equal(series.length, 3);
    assert.equal(series[1].profit, 0);
    assert.equal(series[1].cumulative, 5);
    assert.equal(series[2].cumulative, 3);
    const notes = buildInsights({
        stats: { valid: 5, wins: 4, losses: 1, flats: 0, winRate: 80, profit: 3, maxProfit: 10, avgWin: 2, avgLoss: -5, excludedMissingClose: 0, missingProfit: 0 },
        bySignal: [{ signal: "SIGNAL_A", profit: 12, valid: 4 }],
        byConfig: [{ env: "a1", profit: -4, valid: 2 }],
        bySide: [{ side: "LONG", profit: 8, valid: 3 }, { side: "SHORT", profit: -5, valid: 2 }],
        rangeLabel: "7 ngày",
        username: "alpha",
    });
    assert.ok(notes.length <= 3);
    assert.ok(notes.some((item) => item.code === "one-win-dependency"));
    assert.equal(notes.some((item) => /tăng vốn|bật bot/i.test(item.text)), false);
});

test("Account Static detail stays inside the selected bot and exposes close metadata", async () => {
    const originals = { user: UserAccount.findOne, one: AccountStatic.findOne, symbols: FuturesSymbol.find };
    let detailFilter;
    UserAccount.findOne = () => query({ username: "alpha", accounts: ["a1"], visibility: "public" });
    AccountStatic.findOne = (filter) => {
        detailFilter = filter;
        return query({
            _id: "a".repeat(24),
            env: "a1",
            typeSignal: "SIGNAL_A",
            symbol: "BTCUSDT",
            side: "LONG",
            status: "WIN",
            profit: 3,
            tps: [1, 2],
            positionAmt: 0.1,
            isCopy: true,
            closeReason: "TP_FILL",
            logs: [{ at: new Date(), event: "CLOSE", message: "done" }],
            stats: { pnlIncludesFees: true },
        });
    };
    FuturesSymbol.find = () => query([]);
    try {
        await assert.rejects(() => getAccountStatic({ role: "viewer", botUsernames: ["alpha"] }, "nope", { username: "alpha" }), /Mã giao dịch không hợp lệ/);
        const row = await getAccountStatic({ role: "viewer", botUsernames: ["alpha"] }, "a".repeat(24), { username: "alpha" });
        assert.deepEqual(detailFilter.env, { $in: ["a1"] });
        assert.equal(row.signal, "SIGNAL_A");
        assert.deepEqual(row.tps, [1, 2]);
        assert.equal(row.copy, true);
        assert.equal(row.positionAmt, 0.1);
        assert.equal(row.closeReason, "TP_FILL");
        assert.equal(row.logs.length, 1);
        assert.match(row.pnlNote, /commission|funding|phí/i);
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
        assert.match(row.roeBasis, /không phải ROI tài khoản/i);
    } finally {
        UserAccount.findOne = originals.user;
        AccountStatic.findOne = originals.one;
        FuturesSymbol.find = originals.symbols;
    }
});

test("Account Static analytics aggregates every user in scope when username=__all__", async () => {
    const originals = {
        find: UserAccount.find,
        rows: AccountStatic.find,
        count: AccountStatic.countDocuments,
        aggregate: AccountStatic.aggregate,
        configs: AccountConfig.find,
        profits: FuturesProfit.find,
    };
    let rowFilter;
    UserAccount.find = () => query([
        { username: "alpha", accounts: ["a1"], ownerUserId: "u1", visibility: "public", active: true },
        { username: "beta", accounts: ["b1"], ownerUserId: "u1", visibility: "public", active: true },
        { username: "gamma", accounts: ["g1"], ownerUserId: "other", visibility: "public", active: true },
    ]);
    AccountConfig.find = () => query([]);
    FuturesProfit.find = () => query([
        {
            env: "A1",
            day: new Date("2026-10-01T00:00:00.000Z"),
            profit: 10,
            fee: -1,
            funding: 0,
            stats: { wallet: { incomeByType: { REALIZED_PNL: 10, COMMISSION: -1 } } },
        },
        {
            env: "B1",
            day: new Date("2026-10-01T00:00:00.000Z"),
            profit: -4,
            fee: -0.5,
            funding: 0,
            stats: { wallet: { incomeByType: { REALIZED_PNL: -4, COMMISSION: -0.5 } } },
        },
    ]);
    AccountStatic.find = (filter) => {
        rowFilter = filter;
        return query([{
            _id: "s1",
            env: "a1",
            typeSignal: "SIGNAL_A",
            symbol: "BTCUSDT",
            side: "LONG",
            status: "WIN",
            profit: 5,
            openTime: new Date(),
            closeTime: new Date(),
        }]);
    };
    AccountStatic.countDocuments = async () => 1;
    AccountStatic.aggregate = async (pipeline) => {
        if (pipeline[1]?.$facet) {
            return [{
                bySignal: [{ _id: "SIGNAL_A", ...totalsRow({ profit: 5 }) }],
                byConfig: [{ _id: "a1", ...totalsRow({ profit: 3 }) }, { _id: "b1", ...totalsRow({ profit: 2 }) }],
                byEnv: [{ _id: "a1", ...totalsRow({ profit: 3 }) }, { _id: "b1", ...totalsRow({ profit: 2 }) }],
                byConfigSignal: [],
                bySymbol: [],
                bySide: [],
                byStatus: [],
            }];
        }
        if (pipeline.some((stage) => stage.$group?._id?.$dateToString)) {
            return [{ _id: "2026-10-01", count: 1, profit: 5 }];
        }
        return [totalsRow({ profit: 5, valid: 1, wins: 1 })];
    };
    try {
        const result = await listAccountStatics(
            { id: "u1", role: "member", botUsernames: ["alpha", "beta"] },
            { username: "__all__", scope: "mine", analytics: "1", range: "7" }
        );
        const flat = flattenMatch(rowFilter);
        assert.deepEqual([...flat.env.$in].sort(), ["a1", "b1"]);
        assert.equal(result.username, "__all__");
        assert.deepEqual(result.usernames, ["alpha", "beta"]);
        assert.equal(result.rows[0].username, "alpha");
        assert.equal(result.stats.byUser.length, 2);
        assert.equal(result.stats.byUser.find((row) => row.username === "alpha")?.profit, 3);
        assert.equal(result.stats.byUser.find((row) => row.username === "beta")?.profit, 2);
        assert.equal(result.stats.byUser.find((row) => row.username === "alpha")?.income, 9);
        assert.equal(result.stats.byUser.find((row) => row.username === "beta")?.income, -4.5);
        assert.equal(result.stats.byConfig.find((row) => row.env === "a1")?.income, 9);
        assert.equal(result.stats.byConfig.find((row) => row.env === "b1")?.income, -4.5);
        assert.equal(result.formulas.income.includes("futures_profits"), true);
    } finally {
        UserAccount.find = originals.find;
        AccountStatic.find = originals.rows;
        AccountStatic.countDocuments = originals.count;
        AccountStatic.aggregate = originals.aggregate;
        AccountConfig.find = originals.configs;
        FuturesProfit.find = originals.profits;
    }
});
