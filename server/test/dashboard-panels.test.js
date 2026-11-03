const test = require("node:test");
const assert = require("node:assert/strict");

const {
    positionNotionalUsdt,
    buildRecentTrades,
    buildAllocation,
    normalizeTradeKind,
    OPEN_SUPPORTED,
} = require("../src/lib/dashboard-panels");

test("normalizeTradeKind allowlist", () => {
    assert.equal(normalizeTradeKind("OPEN"), "open");
    assert.equal(normalizeTradeKind("close"), "close");
    assert.equal(normalizeTradeKind("weird"), "all");
});

test("positionNotionalUsdt prefers notional and excludes contracts without base", () => {
    assert.equal(positionNotionalUsdt({ notional: "1200.5" }), 1200.5);
    assert.equal(positionNotionalUsdt({
        quantityUnit: "base",
        positionAmt: "0.1",
        markPrice: "50000",
    }), 5000);
    assert.equal(positionNotionalUsdt({
        quantityUnit: "contracts",
        quantity: "10",
        positionAmt: "10",
        markPrice: "100",
    }), null);
    assert.equal(positionNotionalUsdt({
        quantityUnit: "contracts",
        baseQuantity: "2",
        markPrice: "100",
    }), 200);
    assert.equal(positionNotionalUsdt({
        quantityUnit: "base",
        positionAmt: "1",
        markPrice: "0",
    }), null);
});

test("buildRecentTrades close-only when open unsupported", () => {
    assert.equal(OPEN_SUPPORTED, false);
    const bots = [{ username: "V", accounts: ["V1"] }];
    const closes = [
        {
            _id: "c1",
            env: "V1",
            symbol: "BTCUSDT",
            side: "LONG",
            typeSignal: "SIG",
            profit: 12.3,
            closeTime: new Date("2026-11-02T10:00:00Z"),
        },
        {
            _id: "c2",
            env: "V1",
            symbol: "ETHUSDT",
            side: "BUY",
            profit: null,
            closeTime: new Date("2026-11-02T09:00:00Z"),
        },
    ];
    const all = buildRecentTrades({ kind: "all", bots, closes, now: new Date("2026-11-03T00:00:00Z") });
    assert.equal(all.openSupported, false);
    assert.equal(all.items.length, 2);
    assert.equal(all.items[0].id, "close:c1");
    assert.equal(all.items[0].kind, "close");
    assert.equal(all.items[0].side, "LONG");
    assert.equal(all.items[0].profit, 12.3);
    assert.equal(all.items[1].side, null);
    assert.equal(all.items[1].profit, null);

    const openOnly = buildRecentTrades({ kind: "open", bots, closes, now: new Date("2026-11-03T00:00:00Z") });
    assert.equal(openOnly.items.length, 0);
    assert.equal(openOnly.kind, "open");

    const closeOnly = buildRecentTrades({ kind: "close", bots, closes, now: new Date("2026-11-03T00:00:00Z") });
    assert.equal(closeOnly.items.length, 2);
});

test("buildAllocation gross hedge and excludes bad contracts; dedupes parent", () => {
    const books = {
        V: {
            source: "exchange",
            exchange: "binance",
            at: "2026-11-03T01:00:00.000Z",
            positions: [
                { symbol: "BTCUSDT", positionSide: "LONG", positionAmt: "0.1", markPrice: "50000", quantityUnit: "base" },
                { symbol: "BTCUSDT", positionSide: "SHORT", positionAmt: "-0.05", markPrice: "50000", quantityUnit: "base" },
                { symbol: "ETHUSDT", positionSide: "LONG", positionAmt: "1", markPrice: "3000", quantityUnit: "base" },
                // duplicate parent identity — ignored
                { symbol: "ETHUSDT", side: "LONG", positionAmt: "1", markPrice: "3000", quantityUnit: "base" },
                // contracts missing base — excluded
                {
                    symbol: "XRP-USDT-SWAP",
                    instrumentId: "XRP-USDT-SWAP",
                    side: "LONG",
                    quantity: "10",
                    positionAmt: "10",
                    quantityUnit: "contracts",
                    markPrice: "2",
                    exchange: "okex",
                },
            ],
        },
        Missing: null,
    };
    const view = buildAllocation({
        usernames: ["V", "Missing"],
        books,
        now: new Date("2026-11-03T02:00:00Z"),
    });
    assert.equal(view.quality, "partial");
    assert.equal(view.coverage.accountsExpected, 2);
    assert.equal(view.coverage.accountsAvailable, 1);
    assert.equal(view.coverage.positionsExcluded >= 1, true);
    // BTC long 5000 + BTC short 2500 + ETH 3000 = 10500 (hedge cộng gross)
    assert.equal(view.gross, 10500);
    const btc = view.bySymbol.find((row) => row.key === "BTCUSDT");
    assert.equal(btc.value, 7500);
    assert.equal(view.bySide.find((row) => row.key === "LONG").value, 8000);
    assert.equal(view.bySide.find((row) => row.key === "SHORT").value, 2500);
    assert.equal(view.rows.length, 3);
});

test("buildAllocation unavailable without books", () => {
    const view = buildAllocation({ usernames: ["V"], books: null });
    assert.equal(view.quality, "unavailable");
    assert.equal(view.gross, null);
});
