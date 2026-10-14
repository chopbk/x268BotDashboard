const test = require("node:test");
const assert = require("node:assert/strict");
const {
    parseEnvList,
    setPeerList,
    nextPeerProxyUrl,
    peerProxyCount,
    urlsFromConfigDoc,
    isProxyTunnelError,
    loadFromEnv,
} = require("../src/lib/binance-peer-proxy");

test("parseEnvList drops self IP", () => {
    const raw =
        "http://u:p@45.32.252.50:13128,http://u:p@45.76.149.189:13128,http://u:p@139.180.133.147:13128";
    const list = parseEnvList(raw, "45.76.149.189");
    assert.equal(list.length, 2);
    assert.ok(!list.some((u) => u.includes("45.76.149.189")));
});

test("round-robin nextPeerProxyUrl", () => {
    setPeerList(
        ["http://u:p@1.1.1.1:13128", "http://u:p@2.2.2.2:13128"],
        { label: "test" }
    );
    assert.equal(peerProxyCount(), 2);
    assert.match(nextPeerProxyUrl(), /1\.1\.1\.1/);
    assert.match(nextPeerProxyUrl(), /2\.2\.2\.2/);
    assert.match(nextPeerProxyUrl(), /1\.1\.1\.1/);
    loadFromEnv({ BINANCE_PEER_PROXIES: "", BINANCE_PEER_PROXY_SELF_IP: "" });
});

test("urlsFromConfigDoc builds and skips self", () => {
    const urls = urlsFromConfigDoc(
        {
            authUser: "botpeer",
            authPass: "secret",
            peers: [
                { ip: "45.32.252.50", port: 13128, enabled: true },
                { ip: "45.77.178.42", port: 13128, enabled: true },
                { ip: "10.0.0.1", port: 13128, enabled: false },
            ],
        },
        "45.77.178.42"
    );
    assert.equal(urls.length, 1);
    assert.match(urls[0], /botpeer:secret@45\.32\.252\.50:13128/);
});

test("isProxyTunnelError detects common failures", () => {
    assert.equal(isProxyTunnelError(new Error("Proxy CONNECT 403")), true);
    assert.equal(isProxyTunnelError(new Error("socket hang up")), true);
    assert.equal(isProxyTunnelError(new Error("Unexpected JSON")), false);
});
