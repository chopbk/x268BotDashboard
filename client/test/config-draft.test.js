import test from "node:test";
import assert from "node:assert/strict";
import { configPayload, configChanges, changedPatch, signalNames, filterConfigs } from "../src/configDraft.js";

const form = { on: true, paper: false, long: true, short: false, mode: "FIX", cost: 25, leverage: 5, ratio: null,
  fixloss: 10, slType: "ATR", sl: 1.5, trailing: true, trailingType: "FIX", sp: .01, trigger: .03,
  syncFrom: "BASE", syncScale: true, syncWalletBal: 1000 };
const lists = { signals: "SIGNAL_A, SIGNAL_B", tpPercent: "0.1, 0.2", syncExcept: "cost, signals" };
const snapshot = { form, lists };

test("diff normalizes numeric input and only PATCHes the edited field", () => {
  assert.deepEqual(configChanges(snapshot, { ...form, cost: "25", ratio: "" }, lists), []);
  const changes = configChanges(snapshot, { ...form, cost: "30" }, lists);
  assert.deepEqual(changedPatch(changes), { cost: 30 });
  assert.deepEqual(changes, [{ key: "cost", before: 25, after: 30 }]);
});

test("mode changes preserve inactive fields and inherited source settings", () => {
  const draft = { ...form, mode: "LOSS" };
  const payload = configPayload(draft, lists);
  assert.equal(payload.cost, 25);
  assert.equal(payload.fixloss, 10);
  assert.equal(payload.syncFrom, "BASE");
  assert.equal(payload.syncWalletBal, 1000);
  assert.deepEqual(changedPatch(configChanges(snapshot, draft, lists)), { mode: "LOSS" });
});

test("ordered TP values remain ordered; list deletions and false flags are not lost", () => {
  const changes = configChanges(snapshot, { ...form, on: false }, { ...lists, signals: "", tpPercent: "0.2, 0.1" });
  assert.deepEqual(changedPatch(changes), { on: false, signals: [], tpPercent: [.2, .1] });
});

test("signal paste deduplicates without uppercasing channel identities", () => {
  assert.deepEqual(signalNames("SIGNAL_A, SIGNAL_A\nSignal_B SIGNAL_C"), ["SIGNAL_A", "Signal_B", "SIGNAL_C"]);
});

test("directory filters use actual paper and signal state, missing records are not live", () => {
  const rows = [{ username: "demo", env: "A", on: true, paper: false, signals: ["SIGNAL_A"] },
    { username: "demo", env: "B", on: false, paper: true, signals: [] },
    { username: "other", env: "C", on: null, paper: null, signals: [] }];
  assert.deepEqual(filterConfigs(rows, { q: "signal_a", book: "live" }).map((row) => row.env), ["A"]);
  assert.deepEqual(filterConfigs(rows, { book: "paper", status: "off", username: "demo" }).map((row) => row.env), ["B"]);
  assert.deepEqual(filterConfigs(rows, { book: "live" }).map((row) => row.env), ["A"]);
});
