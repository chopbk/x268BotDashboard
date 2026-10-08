const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
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

for (const isOpen of [false, true]) {
    test(`failed Redis connection falls back when client isOpen=${isOpen}`, async () => {
        let destroyed = 0;
        const client = {
            isOpen,
            on() {},
            async connect() { throw new Error("ECONNREFUSED"); },
            destroy() {
                if (!this.isOpen) throw new Error("The client is closed");
                destroyed += 1;
                this.isOpen = false;
            },
        };
        const module = { exports: {} };
        vm.runInNewContext(fs.readFileSync(require.resolve("../src/lib/rate-limit-store"), "utf8"), {
            module,
            require(name) { assert.equal(name, "redis"); return { createClient: () => client }; },
            console: { error() {}, log() {} },
        });
        const store = module.exports;
        assert.equal(await store.connectRateLimitStore("redis://127.0.0.1:6379"), null);
        assert.equal(destroyed, isOpen ? 1 : 0);
        assert.equal(store.rateLimitStoreStatus(), "memory");
        assert.equal((await store.consumeRateLimit("login:test", 1000, 10000)).count, 1);
        assert.equal((await store.consumeRateLimit("login:test", 1000, 10100)).count, 2);
    });
}
