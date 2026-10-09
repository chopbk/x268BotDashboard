const test = require("node:test");
const assert = require("node:assert/strict");
const { ingestMarkPrices, MARK_URL } = require("../src/lib/mark-prices");

test("the all-market mark stream keeps the latest price per symbol", () => {
    const store = new Map();
    ingestMarkPrices([
        { e: "markPriceUpdate", s: "ethusdt", p: "130.5" },
        { e: "markPriceUpdate", s: "BTCUSDT", p: "0" },
        { s: "SOLUSDT", p: "20" },
    ], store);
    assert.equal(store.get("ETHUSDT"), 130.5);
    assert.equal(store.has("BTCUSDT"), false);
    assert.equal(store.get("SOLUSDT"), 20);
    assert.equal(MARK_URL.includes("!markPrice@arr@1s"), true);
});
