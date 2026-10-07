const test = require("node:test");
const assert = require("node:assert/strict");
const config = require("../src/config");
const { requireCsrf, sameToken } = require("../src/middleware/csrf");
const { createRateLimit } = require("../src/middleware/rate-limit");

function response() {
    return {
        statusCode: 200, headers: {}, body: null,
        set(name, value) { this.headers[name] = value; return this; },
        status(code) { this.statusCode = code; return this; },
        json(value) { this.body = value; return this; },
    };
}

test("CSRF accepts matching cookie/header only from the configured origin", () => {
    const token = "safe-token";
    let passed = false;
    const req = { method: "POST", cookies: { [config.csrfCookieName]: token }, get: (name) => ({ origin: config.clientOrigin, "x-csrf-token": token }[name]) };
    requireCsrf(req, response(), () => { passed = true; });
    assert.equal(passed, true);
    assert.equal(sameToken(token, token), true);
});

test("CSRF rejects a foreign origin before mutation", () => {
    const req = { method: "PATCH", cookies: {}, get: (name) => name === "origin" ? "https://evil.example" : "" };
    const res = response();
    requireCsrf(req, res, () => assert.fail("must not pass"));
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, "CSRF_ORIGIN");
});

test("rate limiter isolates identifiers and returns retry metadata", () => {
    const middleware = createRateLimit({ windowMs: 60_000, max: 2, prefix: "test", identify: (req) => req.body.identifier });
    const request = (identifier) => ({ ip: "127.0.0.1", body: { identifier } });
    for (let i = 0; i < 2; i += 1) middleware(request("alice"), response(), () => {});
    const blocked = response();
    middleware(request("alice"), blocked, () => assert.fail("must be limited"));
    assert.equal(blocked.statusCode, 429);
    assert.ok(Number(blocked.headers["Retry-After"]) >= 1);
    let bobPassed = false;
    middleware(request("bob"), response(), () => { bobPassed = true; });
    assert.equal(bobPassed, true);
});
