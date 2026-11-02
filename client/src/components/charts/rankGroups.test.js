import test from "node:test";
import assert from "node:assert/strict";
import { rankGroups, summarizeTop } from "./rankGroups.js";
import { buildCalendar, pnlLevel, utcWeekdayMon0 } from "./calendar.js";

test("rankGroups sorts by absolute PnL and separates remainder gain/loss", () => {
  const rows = [
    { signal: "A", profit: 10, count: 5, winRate: 60 },
    { signal: "B", profit: -30, count: 8, winRate: 20 },
    { signal: "C", profit: 5, count: 2, winRate: 50 },
    { signal: "D", profit: -2, count: 1, winRate: 0 },
    { signal: "E", profit: null, count: 3, winRate: 40 },
  ];
  const ranked = rankGroups(rows, { nameKey: "signal", limit: 2, mode: "abs" });
  assert.deepEqual(ranked.shown.map((row) => row.name), ["B", "A"]);
  assert.equal(ranked.totalGroups, 4);
  assert.equal(ranked.restCount, 2);
  assert.equal(ranked.restGain, 5);
  assert.equal(ranked.restLoss, -2);
  assert.match(summarizeTop(ranked), /B đóng góp/);
});

test("rankGroups gain and loss modes exclude opposite sign", () => {
  const rows = [
    { symbol: "BTC", profit: 12, count: 3 },
    { symbol: "ETH", profit: -8, count: 4 },
    { symbol: "SOL", profit: 3, count: 2 },
  ];
  const gain = rankGroups(rows, { nameKey: "symbol", mode: "gain", limit: 10 });
  assert.deepEqual(gain.shown.map((row) => row.name), ["BTC", "SOL"]);
  const loss = rankGroups(rows, { nameKey: "symbol", mode: "loss", limit: 10 });
  assert.deepEqual(loss.shown.map((row) => row.name), ["ETH"]);
});

test("buildCalendar pads weeks Mon-Sun UTC and treats empty days as zero", () => {
  // 2026-11-02 is Monday
  const cal = buildCalendar([
    { day: "2026-11-02", profit: 5, trades: 2 },
    { day: "2026-11-03", profit: -1, trades: 1 },
    { day: "2026-11-04", profit: 0, trades: 0 },
  ]);
  assert.equal(utcWeekdayMon0(new Date("2026-11-02T00:00:00.000Z")), 0);
  assert.equal(cal.weekdays[0], "T2");
  assert.ok(cal.weeks.length >= 1);
  const wed = cal.cells.find((cell) => cell.day === "2026-11-04");
  assert.equal(wed.profit, 0);
  assert.equal(wed.trades, 0);
  assert.equal(pnlLevel(5, 5, false), "pos-5");
  assert.equal(pnlLevel(0, 5, false), "zero");
  assert.equal(pnlLevel(null, 5, true), "missing");
});

test("null profit points are not coerced to zero in ranking", () => {
  const ranked = rankGroups([{ signal: "X", profit: null, count: 0 }], { nameKey: "signal" });
  assert.equal(ranked.shown.length, 0);
  assert.equal(ranked.totalGroups, 0);
});
