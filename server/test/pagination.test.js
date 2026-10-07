const test = require("node:test");
const assert = require("node:assert/strict");
const { pagination, escapeRegex } = require("../src/lib/pagination");

test("pagination clamps invalid and excessive values", () => {
    assert.deepEqual(pagination({ page: "-4", limit: "1000" }), { page: 1, limit: 100, skip: 0 });
    assert.deepEqual(pagination({ page: "3", limit: "20" }), { page: 3, limit: 20, skip: 40 });
});

test("search text is escaped before becoming a regular expression", () => {
    const value = "user.*[x]";
    assert.equal(new RegExp(escapeRegex(value), "i").test(value), true);
    assert.equal(new RegExp(escapeRegex(value), "i").test("userZZx"), false);
});
