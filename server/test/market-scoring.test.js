const test = require("node:test");
const assert = require("node:assert/strict");
const {
    rsiSeries,
    macdSeries,
    adxSeries,
    bollingerSeries,
    supertrendSeries,
    relativeVolumeAt,
    computeIndicators,
} = require("../src/lib/market/indicators");
const { scoreTimeframe, normalizeScore, leadingBias } = require("../src/lib/market/score-frame");
const { composeStyle, leanLabel } = require("../src/lib/market/composite");
const { parseKlines, splitClosed } = require("../src/lib/market/candles");
const { analyzeSmc, pickSmcPoints } = require("../src/lib/market/smc-structure");
const { FORMULA_VERSION } = require("../src/lib/market/config");

function makeCandles(n, { start = 100, drift = 0.2, vol = 1000, intervalMs = 60_000 } = {}) {
    const out = [];
    let px = start;
    const t0 = Date.UTC(2024, 0, 1);
    for (let i = 0; i < n; i += 1) {
        px += drift + (i % 7 === 0 ? 0.8 : i % 5 === 0 ? -0.5 : 0.05);
        const open = px - 0.2;
        const close = px;
        const high = Math.max(open, close) + 0.4;
        const low = Math.min(open, close) - 0.4;
        const openTime = t0 + i * intervalMs;
        out.push({
            openTime,
            open,
            high,
            low,
            close,
            volume: vol * (1 + (i % 10) / 10),
            closeTime: openTime + intervalMs - 1,
        });
    }
    return out;
}

test("normalizeScore clamp /13*100", () => {
    assert.equal(normalizeScore(0), 0);
    assert.equal(normalizeScore(13), 100);
    assert.equal(normalizeScore(6.5), 50);
    assert.equal(normalizeScore(20), 100);
    assert.equal(normalizeScore(null), null);
});

test("RSI boundary fixtures", () => {
    const up = makeCandles(40, { drift: 1.5, start: 50 });
    const closesUp = up.map((c) => c.close);
    const rsiUp = rsiSeries(closesUp, 14);
    assert.ok(rsiUp.last != null && rsiUp.last > 70);

    const down = makeCandles(40, { drift: -1.5, start: 200 });
    const rsiDown = rsiSeries(down.map((c) => c.close), 14);
    assert.ok(rsiDown.last != null && rsiDown.last < 30);
});

test("MACD signal từ chuỗi đầy đủ", () => {
    const candles = makeCandles(80, { drift: 0.5 });
    const macd = macdSeries(candles.map((c) => c.close));
    assert.ok(macd.macd != null);
    assert.ok(macd.signal != null);
    assert.ok(macd.hist != null);
});

test("Bollinger dùng σ population", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    const bb = bollingerSeries(closes, 20, 2);
    assert.ok(bb.upper > bb.middle);
    assert.ok(bb.lower < bb.middle);
    const mean = closes.reduce((a, b) => a + b, 0) / 20;
    let sumSq = 0;
    for (const x of closes) sumSq += (x - mean) ** 2;
    const sd = Math.sqrt(sumSq / 20);
    // bb.upper đã roundPrice — so sánh series thô
    assert.ok(Math.abs(bb.upperSeries[19] - (mean + 2 * sd)) < 1e-9);
});

test("ADX / Supertrend trả giá trị khi đủ nến", () => {
    const candles = makeCandles(80, { drift: 0.4 });
    const adx = adxSeries(candles, 14);
    assert.ok(adx.adx != null);
    const st = supertrendSeries(candles, 10, 3);
    assert.ok(st.direction === "up" || st.direction === "down");
});

test("relative volume không gồm chính nó", () => {
    const candles = makeCandles(30, { vol: 100 });
    candles[29].volume = 300;
    const rel = relativeVolumeAt(candles, 29, 20);
    assert.ok(rel != null && rel > 2);
});

test("forming candle bị loại khỏi closed", () => {
    const candles = makeCandles(10, { intervalMs: 60_000 });
    const last = candles[candles.length - 1];
    const during = splitClosed(candles, "1h", last.closeTime); // còn forming
    assert.equal(during.closed.length, 9);
    assert.ok(during.forming);
    const after = splitClosed(candles, "1h", last.closeTime + 1);
    assert.equal(after.closed.length, 10);
    assert.equal(after.forming, null);
});

test("parseKlines reject OHLCV sai", () => {
    const raw = [
        [1, "10", "9", "8", "9", "1", 2], // high < open invalid-ish: high 9 < open 10
        [2, "10", "12", "9", "11", "2", 3],
    ];
    const parsed = parseKlines(raw);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].close, 11);
});

test("scoreTimeframe warming khi thiếu nến; ready khi đủ", () => {
    const short = makeCandles(80);
    const warm = scoreTimeframe(short, { timeframe: "15m", now: short[short.length - 1].closeTime + 1 });
    assert.equal(warm.quality.overall, "warming");
    assert.equal(warm.longScore, null);
    assert.ok(warm.breakdown.length > 0);

    const full = makeCandles(260, { drift: 0.15 });
    const ready = scoreTimeframe(full, { timeframe: "15m", now: full[full.length - 1].closeTime + 1 });
    assert.equal(ready.formulaVersion, FORMULA_VERSION);
    assert.ok(ready.longScore != null || ready.shortScore != null);
    assert.equal(ready.quality.overall, "ready");
    // Breakdown Long+Short phải cộng được ra raw
    const longSum = ready.breakdown.filter((r) => r.side === "long").reduce((s, r) => s + r.points, 0);
    assert.ok(Math.abs(longSum - ready.longRaw) < 1e-9);
});

test("RSI rule Long <45 = +1.5", () => {
    const candles = makeCandles(260, { drift: -0.8, start: 300 });
    const scored = scoreTimeframe(candles, { timeframe: "1h", now: candles[candles.length - 1].closeTime + 1 });
    const rsiLong = scored.breakdown.find((r) => r.id === "rsi" && r.side === "long");
    assert.ok(rsiLong);
    if (scored.indicators?.rsi14 < 45) assert.equal(rsiLong.points, 1.5);
});

test("leadingBias cần lệch ≥5", () => {
    assert.equal(leadingBias(70, 68), "wait");
    assert.equal(leadingBias(72, 60), "long");
    assert.equal(leadingBias(50, 60), "short");
});

test("composite thiếu khung → null, không tái phân bổ", () => {
    const byTf = {
        "15m": { longScore: 70, shortScore: 40, bias: "long", regime: "trending" },
        "1h": { longScore: 68, shortScore: 42, bias: "long", regime: "trending" },
        // thiếu 4h
    };
    const c = composeStyle(byTf, "intraday");
    assert.equal(c.compositeLong, null);
    assert.equal(c.status, "incomplete");
    assert.ok(c.missingFrames.includes("4h"));
});

test("leanLabel ngưỡng 65 / delta 15", () => {
    assert.equal(leanLabel(70, 50), "lean_long");
    assert.equal(leanLabel(70, 60), "wait");
    assert.equal(leanLabel(50, 70), "lean_short");
});

test("SMC pick trần 2 điểm", () => {
    const evidence = [
        { side: "long", points: 2, type: "sweep", explanation: "sweep", evidenceTime: 1 },
        { side: "long", points: 1.5, type: "bos", explanation: "bos", evidenceTime: 1 },
    ];
    const picked = pickSmcPoints(evidence, "long");
    assert.equal(picked.points, 2);
});

test("analyzeSmc chạy trên chuỗi tăng", () => {
    const candles = makeCandles(80, { drift: 0.6 });
    const ind = computeIndicators(candles);
    const smc = analyzeSmc(candles, { atr14: ind.atr14, rsiSeries: ind.rsiSeries });
    assert.ok(["bullish", "bearish", "expanding", "contracting", "mixed", "unknown"].includes(smc.structureBias));
});

test("forming không đổi score: cùng closed → cùng dataVersion", () => {
    const candles = makeCandles(260);
    const closed = candles.slice(0, -1);
    const a = scoreTimeframe(closed, { timeframe: "5m", now: closed[closed.length - 1].closeTime + 1 });
    const b = scoreTimeframe(closed, { timeframe: "5m", now: closed[closed.length - 1].closeTime + 30_000 });
    assert.equal(a.dataVersion, b.dataVersion);
    assert.equal(a.longScore, b.longScore);
    assert.equal(a.shortScore, b.shortScore);
});
