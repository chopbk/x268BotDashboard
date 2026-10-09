const test = require("node:test");
const assert = require("node:assert/strict");

process.env.WEB_JWT_SECRET = "test-secret-at-least-16-characters";

const { collapseTrades, summarizeBook, narrateTrade, rMultiple, reasonLabel, historyWindow } = require("../src/lib/position-history");

test("same monitor is one trade and two configs of one symbol stay separate", () => {
    const open = new Date("2026-10-01T00:00:00.000Z");
    const rows = collapseTrades([
        { _id: "a", env: "B1", symbol: "BTCUSDT", side: "LONG", openTime: open, profit: 1, updatedAt: new Date("2026-10-02T00:00:00.000Z") },
        { _id: "b", env: "B1", symbol: "BTCUSDT", side: "LONG", openTime: open, profit: 9, updatedAt: new Date("2026-10-03T00:00:00.000Z") },
        { _id: "c", env: "B2", symbol: "BTCUSDT", side: "LONG", openTime: open, profit: 3, updatedAt: new Date("2026-10-02T00:00:00.000Z") },
        { _id: "d", env: "B1", symbol: "BTCUSDT", side: "LONG", openTime: new Date("2026-10-05T00:00:00.000Z"), profit: 4, updatedAt: new Date("2026-10-05T00:00:00.000Z") },
    ]);
    assert.deepEqual(rows.map((row) => row._id).sort(), ["b", "c", "d"]);
});

test("summary skips missing profit and keeps live paper apart", () => {
    const live = summarizeBook([
        { profit: 10, openTime: "2026-10-01T00:00:00.000Z", closeTime: "2026-10-01T02:00:00.000Z" },
        { profit: -4, openTime: "2026-10-02T00:00:00.000Z", closeTime: "2026-10-02T01:00:00.000Z" },
        { profit: null, openTime: "2026-10-03T00:00:00.000Z", closeTime: "2026-10-03T01:00:00.000Z" },
    ]);
    assert.equal(live.wins, 1);
    assert.equal(live.losses, 1);
    assert.equal(live.missingProfit, 1);
    assert.equal(live.winRate, 50);
    assert.equal(live.profit, 6);
    assert.equal(live.avgWin, 10);
    assert.equal(live.avgLoss, -4);
    assert.equal(live.profitFactor, 2.5);
    const onlyWins = summarizeBook([{ profit: 5, openTime: "2026-10-01T00:00:00.000Z", closeTime: "2026-10-01T01:00:00.000Z" }]);
    assert.equal(onlyWins.profitFactor, null);
    assert.equal(summarizeBook([{ openTime: "2026-10-01T00:00:00.000Z" }]).profit, null);
});

test("narrative and R stay inside recorded evidence", () => {
    assert.equal(reasonLabel(""), "Không xác định");
    assert.equal(reasonLabel("END_MONITOR"), "Không xác định");
    assert.match(narrateTrade({ logs: [], closeReason: "" }), /Không đủ log/);
    assert.match(narrateTrade({ logs: [{ event: "TRAIL_SL", message: "dời" }], closeReason: "END_MONITOR" }), /trailing/);
    assert.doesNotMatch(narrateTrade({ logs: [{ event: "CLOSE", message: "đóng" }], closeReason: "" }), /TP/);
    assert.equal(rMultiple({ entryPrice: 100, positionAmt: 2, profit: 10, stats: {} }), null);
    assert.equal(rMultiple({ entryPrice: 100, positionAmt: 2, profit: 10, stats: { slPriceOpen: 95 } }), 1);
});

test("today and custom bounds are UTC calendar days", () => {
    const now = new Date("2026-10-09T16:00:00.000Z");
    assert.equal(historyWindow({ range: "today" }, now).from.toISOString(), "2026-10-09T00:00:00.000Z");
    const custom = historyWindow({ range: "custom", from: "2026-10-01", to: "2026-10-03" }, now);
    assert.equal(custom.from.toISOString(), "2026-10-01T00:00:00.000Z");
    assert.equal(custom.to.toISOString(), "2026-10-03T23:59:59.999Z");
});
