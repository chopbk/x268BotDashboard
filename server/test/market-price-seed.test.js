const test = require("node:test");
const assert = require("node:assert/strict");
const {
    buildPriceSeed,
    hasScoredFrames,
    applyTickerPrice,
    estimateEtaSeconds,
} = require("../src/lib/market/price-seed");

test("buildPriceSeed có giá, chưa có score", () => {
    const snap = buildPriceSeed({
        symbol: "btcusdt",
        ticker: { lastPrice: 100, priceChangePercent: 1.5, quoteVolume: 1e9 },
        meta: { volumeRank: 1, inTop: true },
        universeVersion: 3,
    });
    assert.equal(snap.symbol, "BTCUSDT");
    assert.equal(snap.qualityOverall, "pending");
    assert.equal(snap.phase, "price");
    assert.equal(snap.price.last, 100);
    assert.equal(snap.timeframes["15m"].quality.overall, "pending");
    assert.equal(hasScoredFrames(snap), false);
});

test("applyTickerPrice cập nhật % mà không xóa frame đã chấm", () => {
    const scored = buildPriceSeed({ symbol: "ETHUSDT", ticker: { lastPrice: 1 } });
    scored.phase = "scored";
    scored.qualityOverall = "ready";
    scored.timeframes["15m"].longScore = 70;
    scored.timeframes["15m"].quality = { overall: "ready" };
    const next = applyTickerPrice(scored, { lastPrice: 2, priceChangePercent: -3, quoteVolume: 9 });
    assert.equal(next.price.last, 2);
    assert.equal(next.price.changePct24h, -3);
    assert.equal(next.timeframes["15m"].longScore, 70);
    assert.equal(hasScoredFrames(next), true);
});

test("estimateEtaSeconds giảm khi remaining = 0", () => {
    assert.equal(estimateEtaSeconds({ remainingSymbols: 0 }), 0);
    assert.ok(estimateEtaSeconds({ remainingSymbols: 50 }) >= 60);
});
