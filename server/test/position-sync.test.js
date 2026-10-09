const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
process.env.WEB_JWT_SECRET = "test-secret-at-least-16-characters";
const live = require("../src/lib/position-live");
const feed = require("../src/lib/position-feed");
const { openSocket } = require("../src/lib/position-ws");
const { loadPositions } = require("../src/lib/positions");
const pause = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));

async function redisFixture(t) {
    const fs = require("node:fs");
    const dir = fs.mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "position-redis-"));
    const path = `${dir}/redis.sock`;
    const child = require("node:child_process").spawn("redis-server", ["--port", "0", "--unixsocket", path, "--save", "", "--appendonly", "no"], { stdio: "ignore" });
    let failure;
    child.on("error", (error) => { failure = error; });
    t.after(() => { child.kill(); fs.rmSync(dir, { recursive: true, force: true }); });
    for (let i = 0; i < 200 && !fs.existsSync(path) && !failure; i++) await pause(10);
    if (failure) throw failure;
    assert.ok(fs.existsSync(path), "Redis Unix socket could not start (run integration tests outside the socket sandbox)");
    const client = require("redis").createClient({ socket: { path, reconnectStrategy: false } });
    client.on("error", () => {});
    await client.connect();
    const connections = [client];
    const duplicate = client.duplicate.bind(client);
    client.duplicate = (...args) => { const next = duplicate(...args); connections.push(next); return next; };
    t.after(() => { live.resetLive(); connections.forEach((conn) => { if (conn.isOpen) conn.destroy(); }); });
    live.bindRedis(client);
    return client;
}

test("web reconciliation deduplicates viewers, shares its Redis lease and rejects stale writes", async (t) => {
    const redis = await redisFixture(t);
    const original = feed.loadBinanceSnapshot;
    t.after(() => { feed.loadBinanceSnapshot = original; });
    let calls = 0;
    let release;
    feed.loadBinanceSnapshot = async () => {
        calls++;
        await new Promise((resolve) => { release = resolve; });
        return { positions: [], income: [], openOrders: [], algoOrders: [] };
    };
    const first = live.reconcile("A");
    const second = live.reconcile("A");
    while (!release) await pause(5);
    assert.equal(calls, 1);
    release();
    const [one, two] = await Promise.all([first, second]);
    assert.deepEqual(one, two);
    assert.deepEqual(one.positions, []);
    assert.deepEqual(one.openOrders, []);
    await live.reconcile("A");
    assert.equal(calls, 1, "fresh baseline should not call REST again");
    const late = await live.saveExchangeBook("A", { ...one, positions: [{ symbol: "BTCUSDT", positionSide: "LONG", positionAmt: "9" }] }, 0);
    assert.deepEqual(late.positions, []);
    assert.equal(late.version, one.version);
    await redis.set("wb:ex:A:refresh", "another-web-instance", { PX: 120000 });
    await live.reconcile("A", { force: true });
    assert.equal(calls, 1, "another instance owns the REST lease");
    await redis.del("wb:ex:A:refresh");
    feed.loadBinanceSnapshot = async () => { calls++; throw Object.assign(new Error("rate limit"), { status: 429, retryAfterMs: 180000 }); };
    await assert.rejects(live.reconcile("A", { force: true }), /rate limit/);
    assert.ok(await redis.pTTL("wb:ex:cooldown") > 120000);
    await live.reconcile("B", { force: true });
    assert.equal(calls, 2, "IP cooldown applies to other accounts too");
    await redis.del("wb:ex:cooldown");
    live.resetLive();
    live.bindRedis(redis);
    feed.loadBinanceSnapshot = async () => { throw Object.assign(new Error("API key rejected"), { status: 401 }); };
    await assert.rejects(live.reconcile("C", { force: true }), /API key rejected/);
    assert.equal(await redis.get("wb:ex:C:refresh"), null, "non-429 errors must release the refresh lease");
});

function socket() {
    const ws = new EventEmitter();
    ws.OPEN = ws.readyState = 1;
    ws.sent = [];
    ws.send = (raw) => ws.sent.push(JSON.parse(raw));
    ws.message = (message) => ws.emit("message", JSON.stringify(message));
    return ws;
}
const query = (value) => ({ select() { return this; }, lean: async () => value });

test("all accounts use one socket, respect scope, deliver empty books and stop on pause", async () => {
    const ws = socket();
    const watchers = new Map();
    const refreshed = [];
    let user = { id: "u1", role: "operator", botUsernames: ["A", "B"] };
    const books = { A: { source: "exchange", positions: [], at: new Date().toISOString(), version: 1 },
        B: { source: "exchange", positions: [], at: new Date().toISOString(), version: 2 } };
    const source = {
        watch(name, cb) { watchers.set(name, cb); return () => watchers.delete(name); },
        async reconcile(name) { refreshed.push(name); },
        async readExchangeBook(name) { return books[name]; },
        async readExchangeBooks(names) { return Object.fromEntries(names.map((name) => [name, books[name]])); },
    };
    const models = {
        UserAccount: { find: () => query(["A", "B", "PRIVATE"].map((username) => ({ username, accounts: [] }))) },
        Monitor: { find: () => query([]) }, Heartbeat: { find: () => query([]) },
    };
    openSocket(ws, user, { live: source, authenticate: async () => user,
        loadPositions: (actor, filters, deps) => loadPositions(actor, filters, { ...models, ...deps }) });
    ws.message({ type: "watch", account: "", audience: "all" });
    await pause();
    assert.deepEqual([...watchers.keys()], ["A", "B"]);
    assert.deepEqual(refreshed, ["A", "B"]);
    assert.deepEqual(ws.sent.at(-1).sources.map((row) => row.account), ["A", "B"]);
    assert.deepEqual(ws.sent.at(-1).rows, []);
    ws.message({ type: "pause" });
    assert.equal(watchers.size, 0);
    ws.message({ type: "resume", account: "PRIVATE", audience: "all" });
    await pause();
    assert.equal(ws.sent.at(-1).type, "error");
    assert.equal(watchers.size, 0);
    ws.message({ type: "resume", account: "A" });
    await pause();
    user = null;
    watchers.get("A")();
    await pause();
    assert.equal(ws.sent.at(-1).type, "error");
    assert.equal(watchers.size, 0);
    ws.emit("close");
});

test("a paused subscription cannot send its slow snapshot into a new account", async () => {
    const ws = socket();
    const watchers = new Map();
    let release;
    openSocket(ws, {}, {
        live: { watch(name, cb) { watchers.set(name, cb); cb(); return () => watchers.delete(name); },
            async reconcile() {}, async readExchangeBook() {} },
        async loadPositions(actor, query, deps) {
            if (deps.priceOf && query.account === "A") await new Promise((resolve) => { release = resolve; });
            return { accounts: [{ username: query.account }], rows: [], account: query.account };
        },
    });
    ws.message({ type: "watch", account: "A" });
    await pause();
    assert.ok(release);
    ws.message({ type: "watch", account: "B" });
    release();
    await pause();
    assert.deepEqual(ws.sent.map((view) => view.account), ["B"]);
    ws.emit("close");
    assert.equal(watchers.size, 0);
});


test("Redis delta publishes through the live watcher into the WebSocket view, including the final close", async (t) => {
    const redis = await redisFixture(t);
    const at = new Date().toISOString();
    await live.saveExchangeBook("A", { source: "exchange", at, income: [], positions: [
        { symbol: "BTCUSDT", positionSide: "LONG", positionAmt: "1", entryPrice: "100" },
    ] }, 0);
    const ws = socket();
    t.after(() => ws.emit("close"));
    const actor = { id: "u1", role: "operator", botUsernames: ["A"] };
    const models = {
        UserAccount: { find: () => query([{ username: "A", accounts: ["A1"] }]) },
        Monitor: { find: () => query([{ _id: "m1", env: "A1", symbol: "BTCUSDT", side: "LONG", positionAmt: "1" }]) },
        Heartbeat: { find: () => query([]) },
    };
    openSocket(ws, actor, { loadPositions: (user, filters, deps) => loadPositions(user, filters, { ...models, ...deps }) });
    ws.message({ type: "watch", account: "A" });
    for (let i = 0; i < 100 && !ws.sent.length; i++) await pause(10);
    assert.equal(ws.sent.at(-1).rows.length, 1);
    const script = require("node:fs").readFileSync(require("node:path").join(__dirname, "../src/lib/exchange-book.lua"), "utf8");
    await redis.eval(script, {
        keys: ["wb:ex:A", "wb:ex:A:ver", "wb:ex:notify:A"],
        arguments: ["delta", JSON.stringify({ positions: [{ symbol: "BTCUSDT", positionSide: "LONG", positionAmt: "0" }] }), String(Date.now()), at, "A"],
    });
    for (let i = 0; i < 100 && ws.sent.at(-1).sources[0].version !== 2; i++) await pause(10);
    assert.equal(ws.sent.at(-1).sources[0].version, 2);
    assert.deepEqual(ws.sent.at(-1).rows, []);
    ws.message({ type: "pause" });
    await pause();
    const subscriptions = await redis.pubSubNumSub(["wb:ex:notify:A", "wb:pos:notify:A", "wb:ord:notify:A"]);
    assert.ok(Object.values(subscriptions).every((count) => count === 0));
});
