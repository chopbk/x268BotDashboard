const { test } = require("node:test");
const assert = require("node:assert/strict");
const { BAL_PREFIX, balanceKey } = require("../src/lib/balance-cache");

test("balanceKey uppercase env", () => {
    assert.equal(balanceKey("b2l"), `${BAL_PREFIX}B2L`);
    assert.equal(balanceKey("  Hoa  "), `${BAL_PREFIX}HOA`);
});
