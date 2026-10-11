import test from "node:test";
import assert from "node:assert/strict";
import { nextAlertGate } from "./position-alert-gate.js";

test("đổi filter → reset, không emit", () => {
  const gate = nextAlertGate({
    watchKey: "a|mine|",
    currentKey: "b|mine|",
    prev: { mode: "live", rows: [] },
    view: { mode: "live", rows: [{ symbol: "BTC" }] },
    armed: true,
  });
  assert.equal(gate.emit, false);
  assert.equal(gate.armed, false);
  assert.equal(gate.watchKey, "b|mine|");
});

test("fast → live không toast (baseline vào trang)", () => {
  const gate = nextAlertGate({
    watchKey: "k",
    currentKey: "k",
    prev: { mode: "fast", rows: [] },
    view: { mode: "live", rows: [{ account: "A", symbol: "BTCUSDT", side: "LONG", book: "live" }] },
    armed: false,
  });
  assert.equal(gate.emit, false);
  assert.equal(gate.armed, true);
});

test("snapshot đầu sau watch không toast", () => {
  const gate = nextAlertGate({
    watchKey: "k",
    currentKey: "k",
    prev: { mode: "live", rows: [] },
    view: { mode: "live", rows: [{ account: "A", symbol: "BTCUSDT", side: "LONG", book: "live" }] },
    armed: false,
  });
  assert.equal(gate.emit, false);
  assert.equal(gate.armed, true);
});

test("đã armed + live → live mới cho phép emit", () => {
  const gate = nextAlertGate({
    watchKey: "k",
    currentKey: "k",
    prev: { mode: "live", rows: [] },
    view: { mode: "live", rows: [{ account: "A", symbol: "BTCUSDT", side: "LONG", book: "live" }] },
    armed: true,
  });
  assert.equal(gate.emit, true);
  assert.equal(gate.armed, true);
});
