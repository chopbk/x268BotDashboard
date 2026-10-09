import assert from "node:assert/strict";
import test from "node:test";
import { roiOf, sortedRows, volumeOf } from "./position-sort.js";

test("volume is qty times mark and falls back to monitor qty", () => {
  assert.equal(volumeOf({ exchangeQty: 2, mark: 10.5 }), 21);
  assert.equal(volumeOf({ exchangeQty: -2, mark: 10 }), 20);
  assert.equal(volumeOf({ exchangeQty: null, mark: 10 }), null);
  assert.equal(volumeOf({ exchangeQty: null, mark: 10, monitors: [{ ownQty: 3 }] }), 30);
  assert.equal(volumeOf({ exchangeQty: 2, mark: null }), null);
  assert.equal(roiOf({ exchangeQty: 2, entry: 10, mark: 12, unrealized: 4, leverage: 5 }), 100);
});

test("column sort toggles numeric volume and keeps rows without a price last", () => {
  const rows = [
    { symbol: "ETHUSDT", side: "LONG", account: "B", exchangeQty: 1, mark: 100 },
    { symbol: "BTCUSDT", side: "SHORT", account: "A", exchangeQty: 1, mark: 50 },
    { symbol: "ADAUSDT", side: "LONG", account: "A", exchangeQty: null, mark: 1 },
  ];
  assert.deepEqual(sortedRows(rows, "volume", "desc").map((row) => row.symbol), ["ETHUSDT", "BTCUSDT", "ADAUSDT"]);
  assert.deepEqual(sortedRows(rows, "account", "asc").map((row) => row.symbol), ["ADAUSDT", "BTCUSDT", "ETHUSDT"]);
  assert.deepEqual(sortedRows(rows, "", "desc").map((row) => row.symbol), ["ETHUSDT", "BTCUSDT", "ADAUSDT"]);
});
