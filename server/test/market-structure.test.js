const test = require("node:test");
const assert = require("node:assert/strict");
const { ema, atr, findSwings, structureBias, parseKlines, analyzeMarketStructure } = require("../src/lib/market-structure");

test("ema và atr trên chuỗi đơn giản", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 + i);
    assert.ok(ema(closes, 20) > 100);
    const candles = closes.map((close, i) => ({
        openTime: i,
        open: close - 0.5,
        high: close + 1,
        low: close - 1,
        close,
        volume: 1,
    }));
    assert.ok(atr(candles, 14) > 0);
});

test("structureBias nhận HH+HL", () => {
    const highs = [{ price: 10 }, { price: 12 }, { price: 14 }];
    const lows = [{ price: 8 }, { price: 9 }, { price: 10 }];
    assert.equal(structureBias(highs, lows).bias, "bullish");
});

test("analyzeMarketStructure từ klines mock", async () => {
    const rows = [];
    let px = 100;
    for (let i = 0; i < 80; i += 1) {
        px += i % 5 === 0 ? 1.2 : 0.3;
        rows.push([
            i * 60_000,
            String(px - 0.5),
            String(px + 1),
            String(px - 1),
            String(px),
            "10",
            0, "0", 0, "0", "0", "0",
        ]);
    }
    const fetchImpl = async (url) => {
        assert.match(url, /klines/);
        return {
            ok: true,
            async json() { return rows; },
        };
    };
    const market = await analyzeMarketStructure("BTCUSDT", {
        side: "LONG",
        entry: 100,
        mark: px,
        fetchImpl,
    });
    assert.equal(market.symbol, "BTCUSDT");
    assert.ok(market.atr14 > 0);
    assert.ok(market.levels.some((l) => l.role === "sl"));
    assert.ok(market.levels.some((l) => l.role === "tp"));
    assert.ok(parseKlines(rows).length === 80);
    assert.ok(findSwings(parseKlines(rows)).highs.length >= 0);
});
