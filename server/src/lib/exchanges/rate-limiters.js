/**
 * Queue/rate limiter tách theo exchange + account.
 * Binance vẫn có thể dùng enqueueBinanceRest riêng; module này cho Bybit/Aster/OKX
 * và API chung getExchangeQueue.
 */

const { enqueueBinanceRest, resetBinanceRestQueueForTests, noteRateLimit: noteBinanceRateLimit } = require("../binance-rest-queue");
const { normalizeExchangeId } = require("./registry");

const BASE_GAP_MS = 400;
const MAX_GAP_MS = 5_000;

/** @type {Map<string, { chain: Promise, lastAt: number, gapMs: number, pending: number }>} */
const queues = new Map();

function queueKey(exchange, account) {
    return `${normalizeExchangeId(exchange)}:${String(account || "").trim().toUpperCase()}`;
}

function getBucket(key) {
    let bucket = queues.get(key);
    if (!bucket) {
        bucket = { chain: Promise.resolve(), lastAt: 0, gapMs: BASE_GAP_MS, pending: 0 };
        queues.set(key, bucket);
    }
    return bucket;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @template T
 * @param {string} exchange
 * @param {string} account
 * @param {() => Promise<T>} fn
 * @param {{ weight?: number }} [opts]
 */
function enqueueExchangeRest(exchange, account, fn, opts = {}) {
    const id = normalizeExchangeId(exchange);
    if (id === "binance") {
        return enqueueBinanceRest(fn, opts);
    }

    const key = queueKey(id, account);
    const bucket = getBucket(key);
    const weight = Math.max(1, Number(opts.weight) || 1);
    bucket.pending += 1;

    const run = bucket.chain.then(async () => {
        const wait = Math.max(0, bucket.gapMs * weight - (Date.now() - bucket.lastAt));
        if (wait > 0) await sleep(wait);
        bucket.lastAt = Date.now();
        try {
            const result = await fn();
            bucket.gapMs = Math.max(BASE_GAP_MS, Math.floor(bucket.gapMs * 0.85));
            return result;
        } catch (error) {
            if (error?.status === 429 || error?.category === "rate_limit") {
                const bump = Math.max(1_200, Number(error.retryAfterMs) || 0, bucket.gapMs * 2);
                bucket.gapMs = Math.min(MAX_GAP_MS, bump);
                console.warn("[exchangeRestQueue]", key, "429 → gapMs=", bucket.gapMs);
            }
            throw error;
        } finally {
            bucket.pending = Math.max(0, bucket.pending - 1);
        }
    });

    bucket.chain = run.then(
        () => undefined,
        () => undefined
    );
    return run;
}

function noteExchangeRateLimit(exchange, account, retryAfterMs = 0) {
    const id = normalizeExchangeId(exchange);
    if (id === "binance") {
        noteBinanceRateLimit(retryAfterMs);
        return;
    }
    const bucket = getBucket(queueKey(id, account));
    const bump = Math.max(1_200, Number(retryAfterMs) || 0, bucket.gapMs * 2);
    bucket.gapMs = Math.min(MAX_GAP_MS, bump);
}

function exchangeQueueStatus(exchange, account) {
    const id = normalizeExchangeId(exchange);
    if (id === "binance") {
        const { binanceRestQueueStatus } = require("../binance-rest-queue");
        return { exchange: id, account, ...binanceRestQueueStatus() };
    }
    const bucket = getBucket(queueKey(id, account));
    return { exchange: id, account, pending: bucket.pending, gapMs: bucket.gapMs, lastAt: bucket.lastAt };
}

function resetExchangeQueuesForTests() {
    queues.clear();
    resetBinanceRestQueueForTests();
}

module.exports = {
    BASE_GAP_MS,
    enqueueExchangeRest,
    noteExchangeRateLimit,
    exchangeQueueStatus,
    resetExchangeQueuesForTests,
    queueKey,
};
