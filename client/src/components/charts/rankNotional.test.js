import test from "node:test";
import assert from "node:assert/strict";
import { topNotionalGroups } from "./rankNotional.js";

test("topNotionalGroups keeps top 5 and folds rest into Khác", () => {
  const rows = [
    { symbol: "BTC", notional: 100 },
    { symbol: "ETH", notional: 80 },
    { symbol: "SOL", notional: 60 },
    { symbol: "XRP", notional: 40 },
    { symbol: "DOGE", notional: 30 },
    { symbol: "ADA", notional: 20 },
    { symbol: "DOT", notional: 10 },
  ];
  const ranked = topNotionalGroups(rows, { limit: 5 });
  assert.equal(ranked.shown.length, 5);
  assert.equal(ranked.shown[0].name, "BTC");
  assert.equal(ranked.other.name, "Khác");
  assert.equal(ranked.other.value, 30);
  assert.equal(ranked.other.count, 2);
  assert.equal(ranked.total, 340);
});

test("topNotionalGroups uses absolute notional and skips zeros", () => {
  const ranked = topNotionalGroups([
    { symbol: "A", notional: -50 },
    { symbol: "B", notional: 0 },
    { symbol: "C", notional: null },
    { symbol: "D", notional: 25 },
  ], { limit: 5 });
  assert.equal(ranked.shown.length, 2);
  assert.equal(ranked.shown[0].value, 50);
  assert.equal(ranked.other, null);
});

test("topNotionalGroups tolerates non-array bySymbol", () => {
  assert.equal(topNotionalGroups(null).shown.length, 0);
  assert.equal(topNotionalGroups({ BTCUSDT: { notional: 1 } }).shown.length, 0);
});
