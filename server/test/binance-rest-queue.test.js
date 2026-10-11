const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
    enqueueBinanceRest,
    resetBinanceRestQueueForTests,
    currentGapMs,
    BASE_GAP_MS,
} = require("../src/lib/binance-rest-queue");
const { eachLimit, EXCHANGE_ACCOUNT_CONCURRENCY } = require("../src/lib/positions");

test("enqueueBinanceRest chạy tuần tự một job tại một thời điểm", async () => {
    resetBinanceRestQueueForTests();
    const order = [];
    const a = enqueueBinanceRest(async () => {
        order.push("a-start");
        await new Promise((r) => setTimeout(r, 30));
        order.push("a-end");
        return 1;
    });
    const b = enqueueBinanceRest(async () => {
        order.push("b-start");
        order.push("b-end");
        return 2;
    });
    const [ra, rb] = await Promise.all([a, b]);
    assert.equal(ra, 1);
    assert.equal(rb, 2);
    assert.deepEqual(order, ["a-start", "a-end", "b-start", "b-end"]);
    assert.ok(currentGapMs() >= BASE_GAP_MS);
});

test("eachLimit mặc định concurrency 1 và tôn trọng gapMs", async () => {
    assert.equal(EXCHANGE_ACCOUNT_CONCURRENCY, 1);
    const seen = [];
    const started = Date.now();
    await eachLimit(
        ["A", "B"],
        1,
        async (name) => {
            seen.push(name);
            return name;
        },
        { gapMs: 50 }
    );
    assert.deepEqual(seen, ["A", "B"]);
    assert.ok(Date.now() - started >= 45);
});
