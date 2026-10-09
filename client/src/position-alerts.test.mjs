import test from "node:test";
import assert from "node:assert/strict";
import { positionAlerts, alertText } from "./position-alerts.js";

test("detects closed, opened and resized live positions", () => {
  const previous = {
    rows: [
      { account: "TAM", symbol: "BTCUSDT", side: "LONG", book: "live", exchangeQty: 1 },
      { account: "TAM", symbol: "ETHUSDT", side: "LONG", book: "live", exchangeQty: 2 },
      { account: "TAM", symbol: "SOLUSDT", side: "LONG", book: "pending", exchangeQty: null },
    ],
  };
  const next = {
    sources: [{ account: "TAM", version: 9 }],
    rows: [
      { account: "TAM", symbol: "BTCUSDT", side: "LONG", book: "live", exchangeQty: 0.5 },
      { account: "TAM", symbol: "XRPUSDT", side: "LONG", book: "live", exchangeQty: 10 },
    ],
  };
  const alerts = positionAlerts(previous, next);
  assert.deepEqual(alerts.map((item) => item.kind).sort(), ["close", "open", "size"]);
  assert.equal(alertText(alerts.find((item) => item.kind === "close")), "TAM · ETHUSDT LONG đã đóng");
});

test("first payload does not invent alerts without a previous book", () => {
  assert.deepEqual(positionAlerts(null, { rows: [{ account: "A", symbol: "BTCUSDT", side: "LONG", book: "live", exchangeQty: 1 }] }), []);
});
