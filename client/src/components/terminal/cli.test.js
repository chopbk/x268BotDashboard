import test from "node:test";
import assert from "node:assert/strict";
import { parseCli, suggestCli, listCommands } from "./cli.js";

test("listCommands lọc theo prefix", () => {
  assert.ok(listCommands("cl").some((c) => c.id === "cl"));
});

test("parseCli /cl 50%", () => {
  const r = parseCli("/cl 50%");
  assert.equal(r.ok, true);
  assert.equal(r.action.type, "close");
  assert.equal(r.action.percent, 50);
});

test("parseCli /o BTCUSDT LONG 1%", () => {
  const r = parseCli("/o BTCUSDT LONG 1%");
  assert.equal(r.ok, true);
  assert.equal(r.action.symbol, "BTCUSDT");
  assert.equal(r.action.side, "LONG");
  assert.equal(r.action.sizeMode, "percent");
  assert.equal(r.action.percent, 1);
});

test("parseCli /long ETHUSDT $100", () => {
  const r = parseCli("/long ETHUSDT $100");
  assert.equal(r.ok, true);
  assert.equal(r.action.side, "LONG");
  assert.equal(r.action.sizeMode, "usdt");
  assert.equal(r.action.usdt, 100);
});

test("suggestCli gợi ý khi gõ /", () => {
  const items = suggestCli("/c");
  assert.ok(items.length >= 1);
});

test("parseCli /clall 50%", () => {
  const r = parseCli("/clall 50%");
  assert.equal(r.ok, true);
  assert.equal(r.action.type, "closeAll");
  assert.equal(r.action.percent, 50);
});
