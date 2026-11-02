const test = require("node:test");
const assert = require("node:assert/strict");
const {
    resolveHistogramWindow,
    shapeHistogramPoints,
    HOUR_MS,
} = require("../src/lib/runtime-histogram");

test("resolveHistogramWindow defaults to 24h hour buckets", () => {
    const now = new Date("2026-11-02T12:00:00.000Z");
    const window = resolveHistogramWindow({}, now);
    assert.equal(window.bucket, "hour");
    assert.equal(window.defaulted, true);
    assert.equal(window.to.toISOString(), now.toISOString());
    assert.equal(window.from.toISOString(), new Date(now.getTime() - 24 * HOUR_MS).toISOString());
});

test("resolveHistogramWindow uses day buckets beyond 48h and clamps 90d", () => {
    const to = new Date("2026-11-02T00:00:00.000Z");
    const from = new Date("2026-07-01T00:00:00.000Z");
    const window = resolveHistogramWindow({ from, to }, to);
    assert.equal(window.bucket, "day");
    const spanDays = (window.to - window.from) / (24 * HOUR_MS);
    assert.ok(spanDays <= 90.001);
});

test("shapeHistogramPoints fills gaps and stacks levels", () => {
    const window = resolveHistogramWindow({
        from: "2026-11-01T00:00:00.000Z",
        to: "2026-11-01T03:00:00.000Z",
    });
    const shaped = shapeHistogramPoints([
        { t: "2026-11-01T00:00:00.000Z", level: "error", count: 2 },
        { t: "2026-11-01T00:00:00.000Z", level: "warn", count: 1 },
        { t: "2026-11-01T02:00:00.000Z", level: "info", count: 4 },
    ], window);
    assert.equal(shaped.bucket, "hour");
    assert.equal(shaped.points.length, 4);
    assert.equal(shaped.points[0].error, 2);
    assert.equal(shaped.points[0].warn, 1);
    assert.equal(shaped.points[0].total, 3);
    assert.equal(shaped.points[1].total, 0);
    assert.equal(shaped.points[2].info, 4);
    assert.equal(shaped.total, 7);
});
