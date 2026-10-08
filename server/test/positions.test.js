const test = require("node:test");
const assert = require("node:assert/strict");

process.env.WEB_JWT_SECRET = "test-secret-at-least-16-characters";

const UserAccount = require("../src/models/user-account");
const MonitorPosition = require("../src/models/monitor-position");
const ProcessHeartbeat = require("../src/models/process-heartbeat");
const { buildPositionView, loadPositions, estimatedPnl } = require("../src/lib/positions");
const { createPositionHub, applyAccountUpdate, applyOrderUpdate } = require("../src/lib/position-feed");

const actor = { id: "u1", role: "operator", username: "me", email: "me@x.com", botUsernames: ["V"] };
const now = new Date("2026-10-08T12:00:00Z").getTime();

function query(value) {
    return {
        select() { return this; },
        lean() { return Promise.resolve(value); },
    };
}

test("exchange pnl is counted once when several monitors share a position", () => {
    const rows = buildPositionView({
        account: "V",
        now,
        connection: "live",
        exchangeLoaded: true,
        heartbeatFresh: true,
        exchangePositions: [{
            symbol: "BTCUSDT",
            positionSide: "LONG",
            positionAmt: "3",
            entryPrice: "100",
            markPrice: "110",
            unRealizedProfit: "30",
            leverage: "5",
            liquidationPrice: "80",
        }],
        monitors: [
            { _id: "a", env: "V1", symbol: "BTCUSDT", side: "LONG", positionAmt: "1", position: { positionAmt: "3", entryPrice: "100" }, signal: "ROSE", updatedAt: new Date(now), closed: false, orders: { stopLoss: { price: 95 } }, config: { TP: 120, TRAILING: "on", HP: 2 } },
            { _id: "b", env: "V2", symbol: "BTCUSDT", side: "LONG", positionAmt: "2", position: { positionAmt: "3", entryPrice: "101" }, signal: "TITAN", updatedAt: new Date(now - 120000), closed: false },
        ],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].unrealized, 30);
    assert.equal(rows[0].exchangeQty, 3);
    assert.equal(rows[0].monitors[0].ownQty, 1);
    assert.equal(rows[0].monitors[0].exchangeSnapshotQty, 3);
    assert.equal(rows[0].monitors[0].estimatedPnl, estimatedPnl("LONG", 100, 110, 1));
    assert.equal(rows[0].monitors[0].estimatedLabel, "ước tính");
    assert.equal(rows[0].monitors[1].ownQty, 2);
    assert.equal(rows[0].monitors[0].watching, true);
    assert.equal(rows[0].monitors[1].watching, false);
    assert.equal(rows[0].monitors[0].expectedOrders[0].confirmed, false);
    assert.equal(rows[0].warnings.includes("qty-mismatch"), false);
});

test("long and short stay apart, paper and notpsl are not merged into exchange pnl", () => {
    const rows = buildPositionView({
        account: "V",
        now,
        connection: "live",
        exchangeLoaded: true,
        exchangePositions: [
            { symbol: "ETHUSDT", positionSide: "LONG", positionAmt: "1", entryPrice: "10", markPrice: "12", unRealizedProfit: "2" },
            { symbol: "ETHUSDT", positionSide: "SHORT", positionAmt: "1", entryPrice: "10", markPrice: "12", unRealizedProfit: "-2" },
        ],
        monitors: [
            { _id: "live", env: "V1", symbol: "ETHUSDT", side: "LONG", positionAmt: "1", futuresClientName: "V", closed: false },
            { _id: "paper", env: "VP", symbol: "ETHUSDT", side: "LONG", positionAmt: "4", isPaper: true, closed: false },
            { _id: "notpsl", env: "V1", symbol: "ETHUSDT", side: "SHORT", positionAmt: "1", type: "NOTPSL", closed: false },
            { _id: "limit", env: "V1", symbol: "SOLUSDT", side: "LONG", positionAmt: "1", isLimit: true, closed: false },
        ],
        openOrders: [{ orderId: 9, symbol: "SOLUSDT", side: "BUY", positionSide: "LONG", type: "LIMIT", price: "20", origQty: "1", status: "NEW" }],
    });
    const long = rows.find((row) => row.symbol === "ETHUSDT" && row.side === "LONG" && row.book === "live");
    const short = rows.find((row) => row.symbol === "ETHUSDT" && row.side === "SHORT" && row.book === "live");
    const paper = rows.find((row) => row.book === "paper");
    const pending = rows.find((row) => row.book === "pending" && row.symbol === "SOLUSDT");
    assert.equal(long.unrealized, 2);
    assert.equal(long.monitors.length, 1);
    assert.equal(short.unrealized, -2);
    assert.equal(short.notpsl, true);
    assert.equal(paper.unrealized, null);
    assert.equal(paper.monitors[0].ownQty, 4);
    assert.equal(pending.exchangeOrders[0].confirmed, true);
    assert.equal(rows.filter((row) => row.book === "live").reduce((sum, row) => sum + row.unrealized, 0), 0);
});

test("warnings cover a position without a monitor, qty drift, and a monitor without a position", () => {
    const rows = buildPositionView({
        account: "V",
        now,
        connection: "stale",
        exchangeLoaded: true,
        exchangePositions: [
            { symbol: "BTCUSDT", positionAmt: "2", entryPrice: "1", markPrice: "2", unRealizedProfit: "2" },
        ],
        monitors: [
            { _id: "part", env: "V1", symbol: "BTCUSDT", side: "LONG", positionAmt: "1", closed: false },
            { _id: "gone", env: "V2", symbol: "XRPUSDT", side: "SHORT", positionAmt: "5", closed: false },
        ],
    });
    const btc = rows.find((row) => row.symbol === "BTCUSDT");
    const xrp = rows.find((row) => row.symbol === "XRPUSDT");
    assert.equal(btc.warnings.includes("qty-mismatch"), true);
    assert.equal(btc.warnings.includes("stale"), true);
    assert.equal(xrp.warnings.includes("monitor-without-position"), true);
    const naked = buildPositionView({
        account: "V",
        exchangePositions: [{ symbol: "BNBUSDT", positionAmt: "1", entryPrice: "1", markPrice: "1", unRealizedProfit: "0" }],
    });
    assert.equal(naked[0].warnings.includes("no-monitor"), true);
    assert.equal(naked[0].unrealized, 0);
});

test("positions stay inside the actor scope and do not leak another account", async () => {
    const originals = {
        users: UserAccount.find,
        monitors: MonitorPosition.find,
        beats: ProcessHeartbeat.find,
    };
    UserAccount.find = () => query([
        { username: "V", accounts: ["V1"], ownerUserId: "other" },
        { username: "OTHER", accounts: ["O1"], ownerUserId: "other" },
    ]);
    MonitorPosition.find = () => query([
        { _id: "mine", env: "V1", futuresClientName: "V", symbol: "BTCUSDT", side: "LONG", positionAmt: "1", closed: false },
        { _id: "other", env: "O1", futuresClientName: "OTHER", symbol: "ETHUSDT", side: "SHORT", positionAmt: "9", closed: false, config: { api_secret: "nope" } },
    ]);
    ProcessHeartbeat.find = () => query([{ at: new Date(now), flags: { monitor: true } }]);
    try {
        const view = await loadPositions(actor, {}, {
            UserAccount, Monitor: MonitorPosition, Heartbeat: ProcessHeartbeat, now,
            snapshot: async () => ({
                positions: [{ symbol: "BTCUSDT", positionAmt: "1", entryPrice: "10", markPrice: "12", unRealizedProfit: "2", api_secret: "hidden" }],
                openOrders: [],
                algoOrders: [],
                status: "live",
                at: new Date(now).toISOString(),
            }),
        });
        assert.deepEqual(view.accounts.map((row) => row.username), ["V"]);
        assert.equal(view.rows.some((row) => row.account === "OTHER" || row.symbol === "ETHUSDT"), false);
        assert.equal(JSON.stringify(view).includes("nope"), false);
        await assert.rejects(() => loadPositions(actor, { account: "OTHER" }, {
            UserAccount, Monitor: MonitorPosition, Heartbeat: ProcessHeartbeat, now,
        }), (error) => error.status === 403);
    } finally {
        UserAccount.find = originals.users;
        MonitorPosition.find = originals.monitors;
        ProcessHeartbeat.find = originals.beats;
    }
});

test("a shared account feed reconnects without dropping or duplicating the snapshot", async () => {
    let userHandlers = null;
    let opens = 0;
    let closes = 0;
    let snapshots = 0;
    let timerId = 1;
    const timers = new Map();
    const events = [];
    const hub = createPositionHub({
        loadSnapshot: async () => {
            snapshots += 1;
            return {
                positions: [{ symbol: "BTCUSDT", positionAmt: "1", positionSide: "LONG", entryPrice: "10", markPrice: "11", unRealizedProfit: "1" }],
                openOrders: [{ orderId: 1, symbol: "BTCUSDT", status: "NEW" }],
                algoOrders: [],
            };
        },
        openListenKey: async () => {
            opens += 1;
            return { listenKey: "secret-key", close: async () => { closes += 1; } };
        },
        connect: (url, handlers) => {
            if (String(url).includes("private")) userHandlers = handlers;
            return { close() {} };
        },
        graceMs: 1000,
        setTimer: (fn, ms) => {
            const id = timerId;
            timerId += 1;
            timers.set(id, { fn, ms });
            return id;
        },
        clearTimer: (id) => timers.delete(id),
    });
    function fire(ms) {
        const match = [...timers.entries()].find(([, timer]) => timer.ms === ms);
        assert.ok(match, `không thấy timer ${ms}`);
        timers.delete(match[0]);
        match[1].fn();
    }
    const stopA = hub.watch("V", (snap) => events.push(snap));
    const stopB = hub.watch("V", () => {});
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(opens, 1);
    assert.equal(snapshots >= 1, true);
    userHandlers.onOpen();
    userHandlers.onMessage({ e: "ORDER_TRADE_UPDATE", o: { i: 1, X: "FILLED", s: "BTCUSDT" } });
    userHandlers.onClose();
    const stale = events.at(-1);
    assert.equal(stale.stale, true);
    assert.equal(stale.positions.length, 1);
    assert.equal(stale.openOrders.length, 0);
    assert.equal(JSON.stringify(events).includes("secret-key"), false);
    fire(1000);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(opens, 2);
    assert.equal(snapshots >= 2, true);
    assert.equal(hub.cached("V").positions.length, 1);
    stopA();
    assert.equal(closes, 1);
    stopB();
    fire(1000);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(closes, 2);
    assert.equal(hub.cached("OTHER"), null);
});

test("account and order events patch the cached position", () => {
    const positions = applyAccountUpdate([
        { symbol: "BTCUSDT", positionSide: "LONG", positionAmt: "1", entryPrice: "10", markPrice: "11" },
    ], { a: { P: [{ s: "BTCUSDT", ps: "LONG", pa: "0", ep: "10" }] } });
    assert.equal(positions.length, 0);
    const orders = applyOrderUpdate([{ orderId: "7", symbol: "ETHUSDT" }], {
        o: { i: 8, X: "NEW", s: "ETHUSDT", S: "SELL", ps: "SHORT", o: "STOP", q: "1" },
    });
    assert.equal(orders.length, 2);
});
