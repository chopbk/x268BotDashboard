const test = require("node:test");
const assert = require("node:assert/strict");
const { collectFactors, ruleSuggestions } = require("../src/lib/trade-factors");
const { analyzeLocal, parseSuggestions } = require("../src/lib/trade-coach");
const { normalizeTags, tradeKeyOf } = require("../src/lib/trade-journal");

test("collectFactors tính khoảng SL theo hướng bất lợi", () => {
    const factors = collectFactors({
        account: "demo",
        symbol: "BTCUSDT",
        side: "LONG",
        entry: 100,
        mark: 102,
        size: 1,
        leverage: 10,
        exchangeSl: 98,
        exchangeTp: 110,
        unrealized: 2,
    });
    assert.equal(factors.movePct, 2);
    assert.ok(Math.abs(factors.slDistancePct - ((102 - 98) / 102) * 100) < 1e-9);
    assert.equal(factors.protection.hasSl, true);
});

test("ruleSuggestions cảnh báo thiếu SL", () => {
    const items = ruleSuggestions(collectFactors({
        account: "demo",
        symbol: "ETHUSDT",
        side: "SHORT",
        entry: 2000,
        mark: 2010,
        size: 1,
        leverage: 25,
    }));
    assert.ok(items.some((i) => /Stop Loss/i.test(i.title)));
    assert.ok(items.some((i) => /Đòn bẩy/i.test(i.title)));
});

test("analyzeLocal không cần AI", () => {
    const out = analyzeLocal({ account: "demo", symbol: "BTCUSDT", side: "LONG", entry: 1, mark: 1, size: 1 });
    assert.equal(out.source, "rules");
    assert.ok(out.suggestions.length >= 1);
});

test("parseSuggestions lọc title rỗng", () => {
    const items = parseSuggestions('{"suggestions":[{"title":"A","detail":"b"},{"title":""}]}');
    assert.equal(items.length, 1);
    assert.equal(items[0].title, "A");
});

test("tradeKeyOf và normalizeTags", () => {
    assert.equal(tradeKeyOf({ account: "u", symbol: "btcusdt", side: "long" }), "u|BTCUSDT|LONG");
    assert.deepEqual(normalizeTags("a, a, b"), ["a", "b"]);
});
