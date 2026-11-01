import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../docs/contracts/quant-terminal/fixtures/q1-workspace-flow.fixture.json"
);

describe("Q1 workspace flow fixture", () => {
  it("covers signal→preview→protection path and chart isolation", () => {
    const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
    assert.equal(fixture.fixtureId, "quant.q1.workspace_flow.v1");
    const ids = fixture.steps.map((s) => s.id);
    for (const need of [
      "select_signal_context",
      "preview",
      "invalidate_on_qty_change",
      "stale_quote",
      "submit_with_preview",
      "chart_error_positions_ok",
      "fast_symbol_switch",
      "mobile_keyboard",
    ]) {
      assert.ok(ids.includes(need), `missing step ${need}`);
    }
    assert.ok(fixture.notVia.includes("MQTT config bridge"));
  });
});
