const test = require("node:test");
const assert = require("node:assert/strict");

const {
    decimalsFromStep,
    toSymbolInfo,
    roundToTick,
    symbolCandidates,
} = require("../src/lib/symbol-info");

test("decimalsFromStep khớp tickSize Binance", () => {
    assert.equal(decimalsFromStep(0.01), 2);
    assert.equal(decimalsFromStep(0.1), 1);
    assert.equal(decimalsFromStep(1), 0);
    assert.equal(decimalsFromStep(0.0000001), 7);
    assert.equal(decimalsFromStep(null), null);
});

test("toSymbolInfo expose priceDecimals từ tickSize", () => {
    const info = toSymbolInfo({
        symbol: "1000PEPEUSDT",
        exchange: "binance",
        tickSize: 0.0000001,
        stepSize: 1,
    });
    assert.equal(info.tickSize, 0.0000001);
    assert.equal(info.priceDecimals, 7);
    assert.equal(info.qtyDecimals, 0);
});

test("roundToTick format theo tickSize", () => {
    assert.equal(roundToTick(0.123456789, 0.0001), "0.1235");
    assert.equal(roundToTick(95000.123, 0.1), "95000.1");
});

test("symbolCandidates thêm/bớt prefix 1000", () => {
    assert.deepEqual(symbolCandidates("PEPEUSDT"), ["PEPEUSDT", "1000PEPEUSDT"]);
    assert.deepEqual(symbolCandidates("1000PEPEUSDT"), ["1000PEPEUSDT", "PEPEUSDT"]);
});
