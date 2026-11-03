import test from "node:test";
import assert from "node:assert/strict";
import { coinSlices, sideSlices, donutArcs } from "./allocationSlices.js";

test("coinSlices top 5 + Khác preserves gross", () => {
  const bySymbol = [
    { key: "A", label: "A", value: 100 },
    { key: "B", label: "B", value: 90 },
    { key: "C", label: "C", value: 80 },
    { key: "D", label: "D", value: 70 },
    { key: "E", label: "E", value: 60 },
    { key: "F", label: "F", value: 50 },
    { key: "G", label: "G", value: 40 },
  ];
  const { slices, total } = coinSlices(bySymbol, { limit: 5 });
  assert.equal(total, 490);
  assert.equal(slices.length, 6);
  assert.equal(slices.at(-1).key, "__other__");
  assert.equal(slices.at(-1).value, 90);
  assert.deepEqual(slices.at(-1).otherKeys.sort(), ["F", "G"]);
});

test("sideSlices and donutArcs handle long/short", () => {
  const { slices, total } = sideSlices([
    { key: "LONG", value: 700 },
    { key: "SHORT", value: 300 },
  ]);
  assert.equal(total, 1000);
  assert.equal(slices.length, 2);
  const arcs = donutArcs(slices, { size: 200, thickness: 20 });
  assert.equal(arcs.paths.length, 2);
  assert.equal(arcs.total, 1000);
  assert.match(arcs.paths[0].d, /^M /);
});
