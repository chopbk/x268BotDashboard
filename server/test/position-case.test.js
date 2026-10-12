const test = require("node:test");
const assert = require("node:assert/strict");
const {
    classifyTimeline,
    monitorStatsView,
    weightedEntry,
    buildDrift,
} = require("../src/lib/position-case");
const {
    dedupeMonitors,
    preferExactSymbol,
    symbolKeys,
    sameSymbol,
} = require("../src/lib/positions");

test("symbolKeys + sameSymbol ETH ↔ ETHUSDT", () => {
    assert.deepEqual(symbolKeys("ETHUSDT"), ["ETHUSDT", "ETH"]);
    assert.deepEqual(symbolKeys("ETH"), ["ETH", "ETHUSDT"]);
    assert.equal(sameSymbol("ETH", "ETHUSDT"), true);
    assert.equal(sameSymbol("BTCUSDT", "ETHUSDT"), false);
});

test("preferExactSymbol ưu tiên đúng symbol sàn", () => {
    const docs = [
        { symbol: "ETH", env: "A", updatedAt: "2026-10-01" },
        { symbol: "ETHUSDT", env: "B", updatedAt: "2026-10-12" },
    ];
    assert.equal(preferExactSymbol(docs, "ETHUSDT").length, 1);
    assert.equal(preferExactSymbol(docs, "ETHUSDT")[0].env, "B");
    assert.equal(preferExactSymbol(docs, "ETH").length, 1);
    assert.equal(preferExactSymbol(docs, "ETH")[0].env, "A");
    // Không gắn zombie ETH vào case ETHUSDT
    assert.equal(preferExactSymbol([{ symbol: "ETH", env: "A" }], "ETHUSDT").length, 0);
});

test("dedupeMonitors giữ bản mới nhất cùng env/symbol/side/signal", () => {
    const kept = dedupeMonitors([
        { env: "PAPER3", symbol: "QNT", side: "SHORT", signal: "X", ownQty: 10, updatedAt: "2026-10-01T00:00:00Z" },
        { env: "PAPER3", symbol: "QNT", side: "SHORT", signal: "X", ownQty: 42, updatedAt: "2026-10-12T00:00:00Z" },
        { env: "PAPER2", symbol: "QNT", side: "SHORT", signal: "X", ownQty: 7, updatedAt: "2026-10-12T00:00:00Z" },
    ]);
    assert.equal(kept.length, 2);
    assert.equal(kept.find((row) => row.env === "PAPER3").ownQty, 42);
});

test("classifyTimeline tags dca partial and sl moves", () => {
    assert.equal(classifyTimeline({ event: "DCA_ADD", message: "avg in" }), "dca");
    assert.equal(classifyTimeline({ event: "PARTIAL_CLOSE" }), "partial_close");
    assert.equal(classifyTimeline({ message: "move SL to BE" }), "sl_move");
    assert.equal(classifyTimeline({ event: "OPEN_FILLED" }), "open");
});

test("weightedEntry averages by qty", () => {
    const avg = weightedEntry([
        { qty: 1, entry: 100 },
        { qty: 3, entry: 120 },
    ]);
    assert.equal(avg, 115);
});

test("monitorStatsView maps max/min roe to mfe/mae", () => {
    const view = monitorStatsView({ maxRoe: 12, minRoe: -4, slMoves: 2 });
    assert.equal(view.mfe, 12);
    assert.equal(view.mae, -4);
    assert.equal(view.slMoves, 2);
});

test("buildDrift flags leftover and own>exchange", () => {
    const leftover = buildDrift({
        exchange: { qty: 10 },
        redis: { at: new Date().toISOString() },
        monitors: [
            { env: "A", ownQty: 4, paper: false, closed: false, watching: true, exchangeSnapshotQty: 10 },
            { env: "B", ownQty: 4, paper: false, closed: false, watching: true, exchangeSnapshotQty: 10 },
        ],
        heartbeatOk: true,
        now: Date.now(),
    });
    assert.equal(leftover.leftover, 2);
    assert.ok(leftover.warnings.some((item) => item.code === "leftover_qty"));

    const over = buildDrift({
        exchange: { qty: 5 },
        redis: { at: new Date().toISOString() },
        monitors: [{ env: "A", ownQty: 8, paper: false, closed: false, watching: true, exchangeSnapshotQty: 5 }],
        heartbeatOk: true,
        now: Date.now(),
    });
    assert.ok(over.warnings.some((item) => item.code === "own_gt_exchange"));
});

test("buildDrift marks no-monitor and redis age as info", () => {
    const noMon = buildDrift({
        exchange: { qty: 3 },
        redis: { at: new Date().toISOString() },
        monitors: [],
        heartbeatOk: true,
        now: Date.now(),
    });
    const note = noMon.warnings.find((item) => item.code === "exchange_open_no_monitor");
    assert.ok(note);
    assert.equal(note.level, "info");

    const stale = buildDrift({
        exchange: { qty: 1 },
        redis: { at: new Date(Date.now() - 120_000).toISOString() },
        monitors: [{ env: "A", ownQty: 1, paper: false, closed: false, watching: true, exchangeSnapshotQty: 1 }],
        heartbeatOk: true,
        now: Date.now(),
    });
    const redis = stale.warnings.find((item) => item.code === "redis_stale");
    assert.ok(redis);
    assert.equal(redis.level, "info");
});
