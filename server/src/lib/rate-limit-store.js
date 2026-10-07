const { createClient } = require("redis");

class MemoryRateLimitStore {
    constructor() {
        this.buckets = new Map();
        this.operations = 0;
    }

    async consume(key, windowMs, now = Date.now()) {
        let bucket = this.buckets.get(key);
        if (!bucket || bucket.resetAt <= now) bucket = { count: 0, resetAt: now + windowMs };
        bucket.count += 1;
        this.buckets.set(key, bucket);
        this.operations += 1;
        if (this.operations % 500 === 0) {
            for (const [storedKey, stored] of this.buckets) if (stored.resetAt <= now) this.buckets.delete(storedKey);
        }
        return { ...bucket };
    }
}

const memoryStore = new MemoryRateLimitStore();
let redisClient = null;
let lastRedisErrorAt = 0;

const CONSUME_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if count == 1 or ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { count, ttl }
`;

function reportRedisFallback(error) {
    const now = Date.now();
    if (now - lastRedisErrorAt < 30_000) return;
    lastRedisErrorAt = now;
    console.error("[rate-limit:redis] fallback memory:", error.message || error);
}

async function connectRateLimitStore(url) {
    if (!url || redisClient?.isReady) return redisClient;
    const client = createClient({
        url,
        socket: { connectTimeout: 5_000, reconnectStrategy: (retries) => retries >= 2 ? false : Math.min((retries + 1) * 200, 2_000) },
    });
    client.on("error", reportRedisFallback);
    try {
        await client.connect();
        redisClient = client;
        console.log("[rate-limit] Redis store connected");
        return client;
    } catch (error) {
        reportRedisFallback(error);
        client.destroy();
        return null;
    }
}

async function consumeRateLimit(key, windowMs, now = Date.now()) {
    if (!redisClient?.isReady) return memoryStore.consume(key, windowMs, now);
    try {
        const [count, ttl] = await redisClient.eval(CONSUME_SCRIPT, { keys: [key], arguments: [String(windowMs)] });
        return { count: Number(count), resetAt: now + Math.max(1, Number(ttl)) };
    } catch (error) {
        reportRedisFallback(error);
        return memoryStore.consume(key, windowMs, now);
    }
}

function rateLimitStoreStatus() {
    return redisClient?.isReady ? "redis" : "memory";
}

module.exports = { MemoryRateLimitStore, connectRateLimitStore, consumeRateLimit, rateLimitStoreStatus };
