const test = require("node:test");
const assert = require("node:assert/strict");
const { collectFactors, ruleSuggestions, marketSuggestions, buildSuggestions } = require("../src/lib/trade-factors");
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

test("marketSuggestions tạo action SL/TP", () => {
    const factors = collectFactors({
        account: "demo",
        symbol: "BTCUSDT",
        side: "LONG",
        entry: 100,
        mark: 102,
        size: 1,
        market: {
            structure15: { bias: "bullish", label: "Cấu trúc tăng" },
            structure1h: { bias: "mixed", label: "Lẫn" },
            ema20: 101,
            ema50: 99,
            atr14: 2,
            atrPct: 2,
            support: 98,
            resistance: 110,
            alignment: "with",
            levels: [
                { id: "sl_atr", role: "sl", label: "SL ATR", price: 97, reason: "1.5 ATR" },
                { id: "tp1", role: "tp", label: "TP1", price: 104, reason: "1 ATR" },
            ],
        },
    });
    const items = marketSuggestions(factors);
    assert.ok(items.some((i) => i.kind === "structure"));
    assert.ok(items.some((i) => i.action?.type === "sl" && i.action.price === 97));
    assert.ok(items.some((i) => i.action?.type === "tp"));
    assert.ok(buildSuggestions(factors).length >= 3);
});

test("analyzeLocal async kèm market mock", async () => {
    const rows = Array.from({ length: 80 }, (_, i) => {
        const px = 100 + i * 0.2;
        return [i, String(px), String(px + 1), String(px - 1), String(px), "1", 0, "0", 0, "0", "0", "0"];
    });
    const fetchImpl = async () => ({ ok: true, async json() { return rows; } });
    const out = await analyzeLocal(
        { account: "demo", symbol: "BTCUSDT", side: "LONG", entry: 100, mark: 110, size: 1 },
        { fetch: fetchImpl }
    );
    assert.equal(out.source, "rules");
    assert.ok(out.factors.market?.atr14 > 0);
    assert.ok(out.suggestions.length >= 1);
    assert.ok(out.levels?.length >= 1);
});

test("parseSuggestions nhận action", () => {
    const items = parseSuggestions(
        '{"suggestions":[{"title":"A","detail":"b","kind":"level","action":{"type":"sl","price":97,"label":"SL"}},{"title":""}]}',
        [{ price: 97 }]
    );
    assert.equal(items.length, 1);
    assert.equal(items[0].action.type, "sl");
    assert.equal(items[0].action.price, 97);
});

test("tradeKeyOf và normalizeTags", () => {
    assert.equal(tradeKeyOf({ account: "u", symbol: "btcusdt", side: "long" }), "u|BTCUSDT|LONG");
    assert.deepEqual(normalizeTags("a, a, b"), ["a", "b"]);
});
