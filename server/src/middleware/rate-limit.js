function normalizeKeyPart(value) {
    return String(value || "").trim().toLowerCase().slice(0, 160);
}

function requestIp(req) {
    return normalizeKeyPart(req.ip || req.socket?.remoteAddress || "unknown");
}

function createRateLimit({ windowMs, max, prefix, identify }) {
    const buckets = new Map();
    let operations = 0;
    return function rateLimit(req, res, next) {
        const now = Date.now();
        const identity = normalizeKeyPart(identify?.(req));
        const key = `${prefix}:${requestIp(req)}:${identity}`;
        let bucket = buckets.get(key);
        if (!bucket || bucket.resetAt <= now) bucket = { count: 0, resetAt: now + windowMs };
        bucket.count += 1;
        buckets.set(key, bucket);

        const setHeader = (name, value) => {
            if (typeof res.set === "function") res.set(name, value);
            else if (typeof res.setHeader === "function") res.setHeader(name, value);
        };
        setHeader("RateLimit-Limit", String(max));
        setHeader("RateLimit-Remaining", String(Math.max(0, max - bucket.count)));
        setHeader("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));
        if (bucket.count > max) {
            const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
            setHeader("Retry-After", String(retryAfter));
            return res.status(429).json({ error: "Thử quá nhiều lần, vui lòng đợi rồi thử lại", retryAfter });
        }

        operations += 1;
        if (operations % 500 === 0) {
            for (const [storedKey, stored] of buckets) if (stored.resetAt <= now) buckets.delete(storedKey);
        }
        next();
    };
}

module.exports = { createRateLimit, normalizeKeyPart, requestIp };
