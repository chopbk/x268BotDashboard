/**
 * Hàng đợi nền chung cho mọi REST Binance signed từ web-bot.
 * Một lúc một request; giãn cách theo weight / cooldown 429.
 */

const BASE_GAP_MS = 400;
const MAX_GAP_MS = 5_000;

let chain = Promise.resolve();
let lastAt = 0;
let gapMs = BASE_GAP_MS;
let pending = 0;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function currentGapMs() {
    return gapMs;
}

function noteSuccess() {
    // Hạ dần về mức nền sau các call ổn định.
    gapMs = Math.max(BASE_GAP_MS, Math.floor(gapMs * 0.85));
}

function noteRateLimit(retryAfterMs = 0) {
    const bump = Math.max(1_200, Number(retryAfterMs) || 0, gapMs * 2);
    gapMs = Math.min(MAX_GAP_MS, bump);
    console.warn("[binanceRestQueue] 429 → gapMs=", gapMs);
}

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ weight?: number }} [opts] weight>1 kéo dài gap trước call (ước lượng).
 * @returns {Promise<T>}
 */
function enqueueBinanceRest(fn, opts = {}) {
    const weight = Math.max(1, Number(opts.weight) || 1);
    pending += 1;
    const run = chain.then(async () => {
        const wait = Math.max(0, gapMs * weight - (Date.now() - lastAt));
        if (wait > 0) await sleep(wait);
        lastAt = Date.now();
        try {
            const result = await fn();
            noteSuccess();
            return result;
        } catch (error) {
            if (error?.status === 429) {
                noteRateLimit(error.retryAfterMs);
            }
            throw error;
        } finally {
            pending = Math.max(0, pending - 1);
        }
    });
    // Không để lỗi một job làm gãy cả queue.
    chain = run.then(
        () => undefined,
        () => undefined
    );
    return run;
}

function resetBinanceRestQueueForTests() {
    chain = Promise.resolve();
    lastAt = 0;
    gapMs = BASE_GAP_MS;
    pending = 0;
}

function binanceRestQueueStatus() {
    return { pending, gapMs, lastAt };
}

module.exports = {
    BASE_GAP_MS,
    enqueueBinanceRest,
    currentGapMs,
    noteRateLimit,
    resetBinanceRestQueueForTests,
    binanceRestQueueStatus,
    sleep,
};
