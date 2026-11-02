import test from "node:test";
import assert from "node:assert/strict";
import { bucketSeries, utcWeekStart } from "./bucketSeries.js";

test("bucketSeries keeps days when <=90", () => {
  const series = Array.from({ length: 30 }, (_, i) => ({
    day: `2026-01-${String(i + 1).padStart(2, "0")}`,
    profit: i % 2 ? 1 : -1,
    trades: 1,
    wins: 1,
    losses: 0,
  }));
  const out = bucketSeries(series, "auto");
  assert.equal(out.bucket, "day");
  assert.equal(out.points.length, 30);
  assert.equal(out.selectable, true);
});

test("bucketSeries folds >90 days into weeks and disables day select", () => {
  const series = [];
  const start = Date.parse("2026-01-01T00:00:00.000Z");
  for (let i = 0; i < 100; i += 1) {
    const day = new Date(start + i * 86400000).toISOString().slice(0, 10);
    series.push({ day, profit: 1, trades: 2, wins: 1, losses: 1 });
  }
  const out = bucketSeries(series, "auto");
  assert.equal(out.bucket, "week");
  assert.ok(out.points.length < 100);
  assert.ok(out.points.length >= 14);
  assert.equal(out.selectable, false);
  const totalProfit = out.points.reduce((s, r) => s + r.profit, 0);
  assert.equal(totalProfit, 100);
  assert.equal(out.points.at(-1).cumulative, 100);
});

test("utcWeekStart is Monday UTC", () => {
  assert.equal(utcWeekStart("2026-11-02"), "2026-11-02"); // Mon
  assert.equal(utcWeekStart("2026-11-01"), "2026-10-26"); // Sun → prior Mon
});
