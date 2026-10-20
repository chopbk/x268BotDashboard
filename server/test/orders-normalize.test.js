const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeAlgoOrder } = require("../src/lib/orders");

test("normalizeAlgoOrder keeps id when only orderId is set (canonical Redis)", () => {
    const row = normalizeAlgoOrder({
        orderId: "2147383305",
        symbol: "BTCUSDT",
        side: "SELL",
        positionSide: "LONG",
        type: "STOP_MARKET",
        status: "NEW",
        quantity: "1",
    }, "B5");
    assert.equal(row.kind, "algo");
    assert.equal(row.orderId, "2147383305");
    assert.equal(row.algoId, "2147383305");
});

test("normalizeAlgoOrder prefers algoId over bogus orderId", () => {
    const row = normalizeAlgoOrder({
        algoId: "99",
        orderId: "0",
        symbol: "ETHUSDT",
        side: "BUY",
        positionSide: "SHORT",
        type: "TAKE_PROFIT_MARKET",
    }, "B5");
    assert.equal(row.orderId, "99");
});
