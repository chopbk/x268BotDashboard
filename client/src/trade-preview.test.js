import assert from "node:assert/strict";
import test from "node:test";
import { closePreview, openPreview, TAKER_FEE_RATE } from "./trade-preview.js";

test("closePreview estimates pnl fee and lists siblings", () => {
  const preview = closePreview({
    side: "LONG",
    entry: 100,
    exitPrice: 110,
    qty: 2,
    monitors: [{ id: "1", env: "A", signal: "ROSE", ownQty: 1 }],
  });
  assert.equal(preview.quantity, 2);
  assert.equal(preview.estimatedPnl, 20);
  assert.equal(preview.estimatedFee, 110 * 2 * TAKER_FEE_RATE);
  assert.equal(preview.siblings.length, 1);
  assert.equal(preview.siblings[0].env, "A");
});

test("openPreview computes notional and fee", () => {
  const preview = openPreview({ side: "SHORT", entryOrMark: 50, quantity: 3 });
  assert.equal(preview.notional, 150);
  assert.equal(preview.estimatedFee, 150 * TAKER_FEE_RATE);
});
