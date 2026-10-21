const test = require("node:test");
const assert = require("node:assert/strict");

process.env.WEB_JWT_SECRET = "test-secret-at-least-16-characters";

const {
    collapseTrades,
    summarizeBook,
    narrateTrade,
    rMultiple,
    reasonLabel,
    historyWindow,
    encodeBinanceHistoryId,
    decodeBinanceHistoryId,
    matchConfigToHistory,
    presentBinanceHistoryRow,
    reasonMatches,
} = require("../src/lib/position-history");

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
    assert.equal(reasonLabel("END_MONITOR"), "Đóng monitor");
    assert.equal(reasonLabel("TP_FILL"), "Khớp hết TP");
    assert.equal(reasonLabel("SL_PROFIT"), "Khớp SL dương");
    assert.equal(reasonLabel("SL_FILL"), "Khớp SL");
    assert.equal(reasonLabel("HSL_FILL"), "Khớp SL");
    assert.equal(reasonLabel("MANUAL_CLOSE"), "Người dùng tự đóng");
    assert.equal(reasonLabel("POSITION_GONE"), "Người dùng tự đóng");
    assert.equal(reasonLabel("SIGNAL_CLOSE"), "Đóng theo tín hiệu");
    assert.match(narrateTrade({ logs: [], closeReason: "" }), /Không đủ log/);
    assert.match(
        narrateTrade({ logs: [{ event: "TRAIL_SL", message: "dời" }], closeReason: "END_MONITOR" }),
        /trailing/i
    );
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

test("binance history id round-trips", () => {
    const id = encodeBinanceHistoryId({
        account: "alice",
        symbol: "btcusdt",
        side: "LONG",
        time: 1710000000000,
        pnl: 12.5,
    });
    assert.match(id, /^bh_/);
    const decoded = decodeBinanceHistoryId(id);
    assert.equal(decoded.account, "alice");
    assert.equal(decoded.symbol, "BTCUSDT");
    assert.equal(decoded.side, "LONG");
    assert.equal(decoded.time, 1710000000000);
    assert.equal(decoded.pnl, 12.5);
});

test("matchConfigToHistory prefers closest closeTime on same symbol/side", () => {
    const closeMs = Date.parse("2026-10-10T12:00:00.000Z");
    const match = matchConfigToHistory(
        { symbol: "ETHUSDT", positionSide: "SHORT", time: closeMs, closedVolume: 2, realizedPnl: -1 },
        [
            { env: "A1", symbol: "ETHUSDT", side: "SHORT", closeTime: new Date(closeMs - 60 * 60 * 1000), positionAmt: 2, typeSignal: "OLD" },
            { env: "A1", symbol: "ETHUSDT", side: "SHORT", closeTime: new Date(closeMs + 2 * 60 * 1000), positionAmt: 2, typeSignal: "NEAR" },
            { env: "B1", symbol: "ETHUSDT", side: "SHORT", closeTime: new Date(closeMs), positionAmt: 2, typeSignal: "OTHER" },
        ],
        ["A1"]
    );
    assert.equal(match.typeSignal, "NEAR");
    assert.equal(match.env, "A1");
});

test("presentBinanceHistoryRow uses Binance PnL and optional config", () => {
    const row = presentBinanceHistoryRow(
        {
            symbol: "BTCUSDT",
            positionSide: "LONG",
            realizedPnl: 8.25,
            entryPrice: 100,
            avgClosePrice: 101,
            closedVolume: 1,
            time: Date.parse("2026-10-10T12:00:00.000Z"),
        },
        "bob",
        { env: "CFG1", typeSignal: "ROSE", closeReason: "TP_FILL", costAmount: 50, isCopy: true }
    );
    assert.equal(row.account, "bob");
    assert.equal(row.env, "CFG1");
    assert.equal(row.signal, "ROSE");
    assert.equal(row.profit, 8.25);
    assert.equal(row.roe, 16.5);
    assert.equal(row.reasonLabel, "Khớp hết TP");
    assert.equal(row.source, "binance_user_trades");
    assert.equal(row.configMatched, true);
    assert.equal(reasonMatches("TP_FILL", "tp"), true);
    assert.equal(reasonMatches("", "unknown"), true);
});
