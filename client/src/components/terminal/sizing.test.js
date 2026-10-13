import test from "node:test";
import assert from "node:assert/strict";
import { estimateSize, qtyFromRisk, qtyFromMarginPercent, qtyFromNotional } from "./sizing.js";

test("qtyFromNotional chia giá và làm tròn xuống step", () => {
  assert.equal(qtyFromNotional(500, 100, 0.1), 5);
  assert.equal(qtyFromNotional(505, 100, 0.1), 5);
});

test("qtyFromMarginPercent: 10% ví × lev / price", () => {
  // available 1000, 10% = 100 margin, lev 10 → notional 1000 → qty 10 @100
  assert.equal(qtyFromMarginPercent(1000, 10, 10, 100, 0.1), 10);
});

test("qtyFromRisk fixture E=100 S=98 B=10", () => {
  assert.equal(qtyFromRisk({ budget: 10, entry: 100, stop: 98, step: 0.1 }), 5);
});

test("estimateSize percent thiếu available → not ready", () => {
  const est = estimateSize({ mode: "percent", percent: 5, leverage: 5, price: 100 });
  assert.equal(est.ready, false);
});

test("estimateSize usdt sẵn sàng", () => {
  const est = estimateSize({ mode: "usdt", usdt: 200, price: 50, step: 0.01 });
  assert.equal(est.ready, true);
  assert.equal(est.quantity, 4);
});
