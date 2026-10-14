const test = require("node:test");
const assert = require("node:assert/strict");
process.env.WEB_JWT_SECRET = "test-secret-at-least-16-characters";

const {
    buildEquity,
    buildFillQuality,
    extractSignalPrice,
    slippageBps,
    attentionFromAttribution,
} = require("../src/lib/ledger-attribution");

test("buildEquity tính Max DD, profit factor, expectancy và time-in-trade", () => {
    const trades = [
        { profit: 10, openTime: "2026-10-01T01:00:00Z", closeTime: "2026-10-01T02:00:00Z" },
        { profit: -4, openTime: "2026-10-02T01:00:00Z", closeTime: "2026-10-02T03:00:00Z" },
        { profit: 6, openTime: "2026-10-03T01:00:00Z", closeTime: "2026-10-03T01:30:00Z" },
        { profit: -20, openTime: "2026-10-04T01:00:00Z", closeTime: "2026-10-04T05:00:00Z" },
    ];
    const { series, metrics } = buildEquity(trades);
    assert.equal(series.length, 4);
    assert.equal(metrics.valid, 4);
    assert.equal(metrics.profit, -8);
    assert.equal(metrics.expectancy, -2);
    assert.equal(metrics.profitFactor, 0.667);
    assert.equal(metrics.maxDrawdown, 20);
    assert.ok(metrics.avgHoldMs > 0);
    assert.ok(metrics.avgHoldLabel);
});

test("slippage bps LONG dương khi entry cao hơn giá signal", () => {
    assert.equal(slippageBps(101, 100, "LONG"), 100);
    assert.equal(slippageBps(99, 100, "SHORT"), 100);
    assert.equal(extractSignalPrice({ prices: { currentPrice: 42.5 } }), 42.5);
});

test("buildFillQuality báo match và mẫu slippage", () => {
    const trades = [
        {
            typeSignal: "SIGNAL_A",
            symbol: "BTCUSDT",
            side: "LONG",
            entryPrice: 101,
            openTime: "2026-10-01T12:00:00Z",
            isLimit: true,
            isCopy: false,
        },
        {
            typeSignal: "SIGNAL_A",
            symbol: "BTCUSDT",
            side: "LONG",
            entryPrice: 100.5,
            openTime: "2026-10-01T13:00:00Z",
            isLimit: false,
            isCopy: true,
            stats: { signalPrice: 100 },
        },
    ];
    const signals = [{
        signal: "SIGNAL_A",
        symbol: "BTCUSDT",
        side: "LONG",
        openTime: "2026-10-01T11:50:00Z",
        prices: { currentPrice: 100 },
    }];
    const fq = buildFillQuality(trades, signals);
    assert.equal(fq.limitCount, 1);
    assert.equal(fq.copyCount, 1);
    assert.equal(fq.matchedSignalPrice, 2);
    assert.ok(fq.avgAbsSlippageBps > 0);
    assert.ok(fq.samples.length >= 1);
});

test("attentionFromAttribution tạo item khi Max DD và PF kém", () => {
    const items = attentionFromAttribution({
        account: {
            metrics: {
                valid: 12,
                maxDrawdown: 80,
                maxDrawdownPct: 40,
                peakEquity: 200,
                profitFactor: 0.7,
            },
        },
        bySignal: [{ name: "SIGNAL_A", profit: -40, valid: 8, winRate: 30 }],
        fillQuality: { avgAbsSlippageBps: 40, matchedSignalPrice: 10 },
    }, "demo");
    assert.ok(items.some((row) => row.type === "drawdown"));
    assert.ok(items.some((row) => row.type === "profit-factor"));
    assert.ok(items.some((row) => row.type === "signal-attribution"));
    assert.ok(items.some((row) => row.type === "slippage"));
    assert.ok(items.every((row) => row.href));
});
