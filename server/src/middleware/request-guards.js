const crypto = require("crypto");

function sessionIdentity(req, cookieName) {
    const userId = req.webUser?.id;
    if (userId) return `user:${userId}`;
    const token = req.cookies?.[cookieName];
    if (!token) return "anonymous";
    return `session:${crypto.createHash("sha256").update(String(token)).digest("hex").slice(0, 24)}`;
}

function createConcurrencyLimit({ max, identify = () => "global", retryAfter = 1 }) {
    const active = new Map();
    return function concurrencyLimit(req, res, next) {
        const key = String(identify(req) || "global");
        const count = active.get(key) || 0;
        if (count >= max) {
            res.set?.("Retry-After", String(retryAfter));
            return res.status(503).json({ error: "Hệ thống đang xử lý nhiều yêu cầu, vui lòng thử lại", retryAfter });
        }
        active.set(key, count + 1);
        let released = false;
        const release = () => {
            if (released) return;
            released = true;
            const remaining = (active.get(key) || 1) - 1;
            if (remaining > 0) active.set(key, remaining);
            else active.delete(key);
        };
        res.once("finish", release);
        res.once("close", release);
        next();
    };
}

function requestTimeout(ms) {
    return function timeoutMiddleware(req, res, next) {
        res.setTimeout(ms, () => {
            if (!res.headersSent) res.status(503).json({ error: "Request xử lý quá lâu, vui lòng thử lại" });
        });
        next();
    };
}

module.exports = { createConcurrencyLimit, requestTimeout, sessionIdentity };
