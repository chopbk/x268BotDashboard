const crypto = require("crypto");
const config = require("../config");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function cookieOptions() {
    return {
        httpOnly: false,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: config.cookieMaxAgeMs,
    };
}

function createToken() {
    return crypto.randomBytes(32).toString("base64url");
}

function sameToken(left, right) {
    if (typeof left !== "string" || typeof right !== "string") return false;
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function issueCsrfToken(req, res) {
    const token = createToken();
    res.cookie(config.csrfCookieName, token, cookieOptions());
    res.json({ csrfToken: token });
}

function requireCsrf(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();
    if (req.get("origin") !== config.clientOrigin) {
        return res.status(403).json({ error: "Nguồn request không hợp lệ", code: "CSRF_ORIGIN" });
    }
    const cookieToken = req.cookies?.[config.csrfCookieName];
    const headerToken = req.get("x-csrf-token");
    if (!sameToken(cookieToken, headerToken)) {
        return res.status(403).json({ error: "CSRF token không hợp lệ", code: "CSRF_TOKEN" });
    }
    next();
}

module.exports = { issueCsrfToken, requireCsrf, sameToken };
