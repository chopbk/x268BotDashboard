const test = require("node:test");
const assert = require("node:assert/strict");
const { MemoryRateLimitStore, connectRateLimitStore, rateLimitStoreStatus } = require("../src/lib/rate-limit-store");

test("memory rate-limit store shares a fixed window by key", async () => {
    const store = new MemoryRateLimitStore();
    const first = await store.consume("key", 1_000, 10_000);
    const second = await store.consume("key", 1_000, 10_100);
    const reset = await store.consume("key", 1_000, 11_001);
    assert.equal(first.count, 1);
    assert.equal(second.count, 2);
    assert.equal(second.resetAt, first.resetAt);
    assert.equal(reset.count, 1);
});

test("empty Redis URL keeps the optional memory fallback", async () => {
    assert.equal(await connectRateLimitStore(""), null);
    assert.equal(rateLimitStoreStatus(), "memory");
});
