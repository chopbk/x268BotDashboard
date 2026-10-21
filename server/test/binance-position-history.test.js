const test = require("node:test");
const assert = require("node:assert/strict");

const {
    groupRealizedPnlIncomes,
    reconstructClosedFromTrades,
    tradeQtyDelta,
} = require("../src/lib/exchanges/binance-futures-adapter");

test("tradeQtyDelta respects hedge LONG/SHORT and one-way BOTH", () => {
    assert.equal(tradeQtyDelta({ side: "BUY", positionSide: "LONG", qty: 2 }), 2);
    assert.equal(tradeQtyDelta({ side: "SELL", positionSide: "LONG", qty: 2 }), -2);
    assert.equal(tradeQtyDelta({ side: "SELL", positionSide: "SHORT", qty: 1 }), 1);
    assert.equal(tradeQtyDelta({ side: "BUY", positionSide: "SHORT", qty: 1 }), -1);
    assert.equal(tradeQtyDelta({ side: "BUY", positionSide: "BOTH", qty: 3 }), 3);
    assert.equal(tradeQtyDelta({ side: "SELL", positionSide: "BOTH", qty: 3 }), -3);
});

test("groupRealizedPnlIncomes merges same-symbol burst", () => {
    const t0 = Date.parse("2026-10-10T12:00:00.000Z");
    const rows = groupRealizedPnlIncomes([
        { symbol: "BTCUSDT", incomeType: "REALIZED_PNL", income: "1.5", time: t0 },
        { symbol: "BTCUSDT", incomeType: "REALIZED_PNL", income: "0.5", time: t0 + 60_000 },
        { symbol: "ETHUSDT", incomeType: "REALIZED_PNL", income: "-2", time: t0 + 60_000 },
        { symbol: "BTCUSDT", incomeType: "REALIZED_PNL", income: "3", time: t0 + 10 * 60_000 },
    ]);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].symbol, "BTCUSDT");
    assert.equal(rows[0].realizedPnl, 2);
    assert.equal(rows[1].symbol, "ETHUSDT");
    assert.equal(rows[1].realizedPnl, -2);
    assert.equal(rows[2].realizedPnl, 3);
    assert.equal(rows[0].source, "income_realized_pnl");
});

test("reconstructClosedFromTrades emits one closed LONG cycle", () => {
    const t0 = 1_700_000_000_000;
    const closed = reconstructClosedFromTrades([
        { id: 1, symbol: "BTCUSDT", positionSide: "LONG", side: "BUY", qty: "1", price: "100", realizedPnl: "0", commission: "0.01", time: t0 },
        { id: 2, symbol: "BTCUSDT", positionSide: "LONG", side: "SELL", qty: "1", price: "110", realizedPnl: "10", commission: "0.01", time: t0 + 1000 },
    ]);
    assert.equal(closed.length, 1);
    assert.equal(closed[0].symbol, "BTCUSDT");
    assert.equal(closed[0].positionSide, "LONG");
    assert.equal(closed[0].realizedPnl, 10);
    assert.equal(closed[0].entryPrice, 100);
    assert.equal(closed[0].avgClosePrice, 110);
    assert.equal(closed[0].closedVolume, 1);
    assert.equal(closed[0].source, "user_trades");
});
