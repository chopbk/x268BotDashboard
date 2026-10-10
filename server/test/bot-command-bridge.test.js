const { test } = require("node:test");
const assert = require("node:assert/strict");
const { ALLOWLIST, applyResponsePayload, publicCommand } = require("../src/lib/bot-command-bridge");

test("allowlist không chứa OPEN/CLOSE và map đúng quyền", () => {
    assert.equal(ALLOWLIST.OPEN, undefined);
    assert.equal(ALLOWLIST.CLOSE, undefined);
    assert.equal(ALLOWLIST.APPLY_CONFIG.permission, "config.edit");
    assert.equal(ALLOWLIST.GET_POSITIONS.permission, "positions.view");
    assert.equal(ALLOWLIST.GET_BALANCE.permission, "statistics.view");
    assert.equal(ALLOWLIST.GET_POSITIONS.mapCommand("DEMO_1"), "DEMO_1/P");
});

test("publicCommand không lộ mappedCommand thừa nếu không có doc", () => {
    assert.equal(publicCommand(null), null);
});

test("applyResponsePayload bỏ qua payload thiếu requestId hoặc version sai", async () => {
    await applyResponsePayload({ version: 1, status: "succeeded", terminal: true });
    await applyResponsePayload({ version: 2, requestId: "x", status: "succeeded", terminal: true });
});
