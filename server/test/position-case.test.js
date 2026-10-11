const test = require("node:test");
const assert = require("node:assert/strict");
const {
    classifyTimeline,
    monitorStatsView,
    weightedEntry,
    buildDrift,
} = require("../src/lib/position-case");

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
