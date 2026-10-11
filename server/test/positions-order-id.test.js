const test = require("node:test");
const assert = require("node:assert/strict");
const { buildPositionView, isClosedDoc } = require("../src/lib/positions");

test("algo order id prefers algoId over bogus orderId", () => {
    const parents = buildPositionView({
        account: "B5",
        monitors: [],
        exchangePositions: [{
            symbol: "CRCLUSDT",
            positionAmt: "10",
            positionSide: "LONG",
            entryPrice: "1",
            markPrice: "1.1",
            unRealizedProfit: "1",
            leverage: "5",
        }],
        openOrders: [],
        algoOrders: [{
            symbol: "CRCLUSDT",
            positionSide: "LONG",
            side: "SELL",
            type: "STOP_MARKET",
            algoId: "2147383305",
            orderId: "0",
            triggerPrice: "0.9",
            quantity: "10",
            algoStatus: "NEW",
            closePosition: true,
        }],
        heartbeatFresh: true,
        now: Date.now(),
        connection: "live",
        exchangeLoaded: true,
    });
    const live = parents.find((row) => row.symbol === "CRCLUSDT" && row.side === "LONG");
    assert.ok(live);
    assert.equal(live.algoOrders.length, 1);
    assert.equal(live.algoOrders[0].id, "2147383305");
    assert.equal(live.algoOrders[0].kind, "algo");
});

test("isClosedDoc treats isClosed flag", () => {
    assert.equal(isClosedDoc({ closed: true }), true);
    assert.equal(isClosedDoc({ isClosed: true }), true);
    assert.equal(isClosedDoc({ closed: false, isClosed: false }), false);
    assert.equal(isClosedDoc({}), false);
});
