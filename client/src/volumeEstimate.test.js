import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateEntrySize } from "./volumeEstimate.js";

test("FIX volume = cost × lev", () => {
  const row = estimateEntrySize({ mode: "FIX", cost: 100, leverage: 10 }, null);
  assert.equal(row.ready, true);
  assert.equal(row.volume, 1000);
});

test("RATIO volume = available × ratio", () => {
  const row = estimateEntrySize(
    { mode: "RATIO", ratio: 0.2, leverage: 5, cost: 50 },
    { available: 1000, balance: 1200 }
  );
  assert.equal(row.ready, true);
  assert.equal(row.volume, 200);
  assert.equal(row.cost, 40);
});

test("RATIO missing wallet → not ready", () => {
  const row = estimateEntrySize({ mode: "RATIO", ratio: 0.2, leverage: 5 }, null);
  assert.equal(row.ready, false);
});
