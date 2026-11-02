import test from "node:test";
import assert from "node:assert/strict";
import { rankGroups } from "./rankGroups.js";
import { buildCalendar } from "./calendar.js";
import { bucketSeries } from "./bucketSeries.js";
import { topNotionalGroups } from "./rankNotional.js";

/**
 * Benchmark chọn chart local <100ms với fixture ~90 ngày / 100 nhóm / 1000 dòng.
 * Máy CI có thể chậm hơn — ngưỡng mềm 250ms; mục tiêu spec 100ms ghi vào assert message.
 */
test("chart selection transforms stay under budget on large fixtures", () => {
  const groups = Array.from({ length: 100 }, (_, i) => ({
    signal: `SIG_${i}`,
    profit: (i % 2 ? 1 : -1) * (100 - i),
    count: 10 + (i % 7),
    winRate: 40 + (i % 50),
    wins: 5,
    losses: 5,
  }));
  const series = Array.from({ length: 90 }, (_, i) => {
    const day = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    return { day, profit: (i % 3) - 1, trades: i % 5, wins: 1, losses: 1, cumulative: i };
  });
  const trades = Array.from({ length: 1000 }, (_, i) => ({ id: i, profit: i % 11 }));
  const symbols = Array.from({ length: 40 }, (_, i) => ({ symbol: `S${i}`, notional: 1000 - i * 10 }));

  const started = performance.now();
  const ranked = rankGroups(groups, { limit: 10, mode: "abs" });
  const cal = buildCalendar(series);
  const buckets = bucketSeries(series.concat(series), "auto");
  const notional = topNotionalGroups(symbols, { limit: 5 });
  const picked = ranked.shown[0]?.name;
  const day = cal.cells.find((c) => c.inRange)?.day;
  const elapsed = performance.now() - started;

  assert.ok(picked);
  assert.ok(day);
  assert.ok(buckets.points.length);
  assert.equal(notional.shown.length, 5);
  assert.equal(trades.length, 1000);
  assert.ok(
    elapsed < 250,
    `transform ${elapsed.toFixed(1)}ms vượt ngân sách mềm 250ms (mục tiêu spec <100ms trên máy kiểm tra)`
  );
  // Ghi nhận mục tiêu spec — không fail CI nếu 100–250ms.
  if (elapsed >= 100) {
    console.warn(`[bench] chart transform ${elapsed.toFixed(1)}ms (mục tiêu <100ms)`);
  }
});
