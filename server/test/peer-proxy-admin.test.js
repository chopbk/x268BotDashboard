const test = require("node:test");
const assert = require("node:assert/strict");
const {
    normalizeIp,
    buildProxyUrl,
    redactProxyList,
} = require("../src/lib/peer-proxy-admin");
const { mergePatch, shouldRedactKey, isForbiddenKey } = (() => {
    const pa = require("../src/lib/process-admin");
    const er = require("../src/lib/env-registry");
    return {
        mergePatch: pa.mergePatch,
        shouldRedactKey: pa.shouldRedactKey,
        isForbiddenKey: er.isForbiddenKey,
    };
})();

test("normalizeIp accepts valid ipv4", () => {
    assert.equal(normalizeIp("45.32.252.50"), "45.32.252.50");
    assert.equal(normalizeIp(" 1.2.3.4 "), "1.2.3.4");
    assert.equal(normalizeIp("999.1.1.1"), null);
    assert.equal(normalizeIp("not-an-ip"), null);
});

test("buildProxyUrl encodes credentials", () => {
    const url = buildProxyUrl("botpeer", "p@ss:word", "45.1.2.3", 13128);
    assert.match(url, /^http:\/\/botpeer:/);
    assert.ok(url.includes("@45.1.2.3:13128"));
    assert.ok(!url.includes("p@ss:word"));
});

test("redactProxyList hides passwords", () => {
    const raw = "http://botpeer:secret@45.1.2.3:13128,http://u:x@1.1.1.1:13128";
    const out = redactProxyList(raw);
    assert.equal(out.includes("secret"), false);
    assert.match(out, /:\*\*\*@/);
});

test("BINANCE_PEER_* registered and patchable", () => {
    assert.equal(isForbiddenKey("BINANCE_PEER_PROXIES"), false);
    assert.equal(isForbiddenKey("BINANCE_PEER_PROXY_SELF_IP"), false);
    assert.equal(shouldRedactKey("BINANCE_PEER_PROXIES"), true);

    const next = mergePatch(
        { NODE_ENV: "prod", TRADER: "true", RUN: "u1" },
        {
            BINANCE_PEER_PROXIES: "http://botpeer:x@45.1.2.3:13128",
            BINANCE_PEER_PROXY_SELF_IP: "45.32.252.50",
        },
        []
    );
    assert.ok(next.BINANCE_PEER_PROXIES);
    assert.equal(next.BINANCE_PEER_PROXY_SELF_IP, "45.32.252.50");

    const cleared = mergePatch(next, {}, ["BINANCE_PEER_PROXIES", "BINANCE_PEER_PROXY_SELF_IP"]);
    assert.equal(cleared.BINANCE_PEER_PROXIES, undefined);
    assert.equal(cleared.BINANCE_PEER_PROXY_SELF_IP, undefined);
});
