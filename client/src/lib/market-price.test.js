import test from "node:test";
import assert from "node:assert/strict";
import { digitsFromTick, fmtMarketPrice } from "./market-price.js";

test("digitsFromTick", () => {
  assert.equal(digitsFromTick(0.01), 2);
  assert.equal(digitsFromTick(0.0000001), 7);
});

test("fmtMarketPrice dùng tickSize / priceDecimals", () => {
  assert.equal(fmtMarketPrice(0.123456789, { tickSize: 0.0001, priceDecimals: 4 }), "0.1235");
  assert.equal(fmtMarketPrice(95000.19, { tickSize: 0.1, priceDecimals: 1 }), "95,000.2");
  assert.equal(fmtMarketPrice(null, { tickSize: 0.01 }), "—");
});
