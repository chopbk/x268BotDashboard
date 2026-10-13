import test from "node:test";
import assert from "node:assert/strict";
import { buildCloseAllItems, closableRows, summarizeCloseAll } from "./closeAll.js";

test("closableRows bỏ paper/pending", () => {
  const rows = [
    { key: "1", book: "live", account: "a", symbol: "BTCUSDT", side: "LONG", exchangeQty: 2, entry: 100, mark: 110 },
    { key: "2", book: "paper", account: "a", symbol: "ETHUSDT", side: "LONG", exchangeQty: 1, entry: 1, mark: 1 },
    { key: "3", book: "pending", account: "a", symbol: "X", side: "SHORT", exchangeQty: 1, entry: 1, mark: 1 },
  ];
  assert.equal(closableRows(rows).length, 1);
});

test("buildCloseAllItems 50% từng vị thế", () => {
  const items = buildCloseAllItems([
    { key: "1", book: "live", account: "a", symbol: "BTCUSDT", side: "LONG", exchangeQty: 2, entry: 100, mark: 110 },
    { key: "2", book: "live", account: "b", symbol: "ETHUSDT", side: "SHORT", exchangeQty: 10, entry: 2000, mark: 1900 },
  ], 50);
  assert.equal(items.length, 2);
  assert.equal(items[0].closeQty, 1);
  assert.equal(items[1].closeQty, 5);
});

test("summarizeCloseAll cộng PnL ước tính", () => {
  const items = buildCloseAllItems([
    { key: "1", book: "live", account: "a", symbol: "BTCUSDT", side: "LONG", exchangeQty: 1, entry: 100, mark: 110 },
  ], 100);
  const sum = summarizeCloseAll(items);
  assert.equal(sum.count, 1);
  assert.equal(sum.estimatedPnl, 10);
});
