const test = require("node:test");
const assert = require("node:assert/strict");

process.env.WEB_JWT_SECRET = "test-secret-at-least-16-characters";

const UserAccount = require("../src/models/user-account");
const MonitorPosition = require("../src/models/monitor-position");
const ProcessHeartbeat = require("../src/models/process-heartbeat");
const { buildPositionView, applyLiveMarks, filterRows, loadPositions, estimatedPnl, deleteMonitorRecord, createMonitorRecord } = require("../src/lib/positions");
const { applyAccountUpdate, applyOrderUpdate, loadExchangeBook, resetExchangeCache } = require("../src/lib/position-feed");
const { parseNotice, decideUpdate } = require("../src/lib/position-cache");
const { watch, resetLive, bindRedis } = require("../src/lib/position-live");

const actor = { id: "u1", role: "operator", username: "me", email: "me@x.com", botUsernames: ["V"] };
const now = new Date("2026-10-08T12:00:00Z").getTime();

function query(value) {
    return {
        select() { return this; },
        lean() { return Promise.resolve(value); },
    };
}

test("pnl uses the current monitor snapshot, not the opening own qty", () => {
    const rows = buildPositionView({
        account: "V",
        now,
        connection: "snapshot",
        exchangeLoaded: false,
        heartbeatFresh: false,
        monitors: [{
            _id: "near",
            env: "V",
            symbol: "NEARUSDT",
            side: "LONG",
            type: "NOTPSL",
            positionAmt: "100",
            closed: false,
            position: { positionAmt: "1106", entryPrice: "4", markPrice: "5" },
        }],
    });
    assert.equal(rows[0].exchangeQty, 1106);
    const priced = applyLiveMarks(rows, () => 5);
    assert.equal(priced.rows[0].unrealized, 1106);
});

test("closing fills record price pnl minus commission and funding", () => {
    const rows = buildPositionView({
        account: "B5",
        now,
        connection: "snapshot",
        exchangeLoaded: true,
        exchangePositions: [{ symbol: "NEARUSDT", positionSide: "LONG", positionAmt: "1106", entryPrice: "4.517", markPrice: "4.86" }],
        monitors: [{ _id: "near", env: "B5", symbol: "NEARUSDT", side: "LONG", positionAmt: "1106", closed: false, startTime: new Date(now - 1000).toISOString() }],
        trades: [{
            symbol: "NEARUSDT",
            positionSide: "LONG",
            side: "SELL",
            qty: "866",
            price: "4.8159",
            realizedPnl: "258.8474",
            commission: "3.83",
            time: now,
        }],
        income: [{ symbol: "NEARUSDT", incomeType: "FUNDING_FEE", income: "-0.0074", time: now }],
    });
    assert.equal(rows[0].recorded.source, "trades");
    assert.ok(Math.abs(rows[0].recorded.realized - 258.8474) < 0.001);
    assert.equal(rows[0].recorded.fee, -3.83);
    assert.ok(Math.abs(rows[0].recorded.net - 255.01) < 0.02);
});

test("position history is the recorded pnl when the endpoint returns it", () => {
    const rows = buildPositionView({
        account: "B5",
        now,
        exchangeLoaded: true,
        exchangePositions: [{ symbol: "NEARUSDT", positionSide: "LONG", positionAmt: "1", entryPrice: "4.517", markPrice: "4.8" }],
        positionHistory: [{ symbol: "NEARUSDT", positionSide: "LONG", closedVolume: "866", entryPrice: "4.517", avgClosePrice: "4.8159", realizedPnl: "255.01", time: now }],
        trades: [{ symbol: "NEARUSDT", positionSide: "LONG", side: "SELL", realizedPnl: "1", commission: "1", time: now }],
    });
    assert.equal(rows[0].recorded.source, "positionHistory");
    assert.equal(rows[0].recorded.net, 255.01);
});

test("binance income fills recorded pnl when the monitor has none", () => {
    const rows = buildPositionView({
        account: "V",
        now,
        connection: "snapshot",
        exchangeLoaded: true,
        exchangePositions: [{ symbol: "ETHUSDT", positionSide: "LONG", positionAmt: "1", entryPrice: "100", markPrice: "110" }],
        income: [
            { symbol: "ETHUSDT", incomeType: "REALIZED_PNL", income: "3" },
            { symbol: "ETHUSDT", incomeType: "COMMISSION", income: "-0.2" },
            { symbol: "BTCUSDT", incomeType: "FUNDING_FEE", income: "9" },
        ],
    });
    assert.equal(rows[0].recorded.net, 2.8);
    assert.equal(rows[0].recorded.source, "income");
});

test("exchange income replaces the monitor stats for recorded pnl", () => {
    const rows = buildPositionView({
        account: "V",
        now,
        connection: "snapshot",
        exchangeLoaded: true,
        exchangePositions: [{ symbol: "ETHUSDT", positionSide: "LONG", positionAmt: "1", entryPrice: "100", markPrice: "110" }],
        monitors: [{
            _id: "e1",
            env: "V",
            symbol: "ETHUSDT",
            side: "LONG",
            closed: false,
            stats: { realizedPnl: 9, commission: 0, funding: 0 },
        }],
        income: [{ symbol: "ETHUSDT", incomeType: "REALIZED_PNL", income: "1.5", time: now }],
    });
    assert.equal(rows[0].recorded.net, 1.5);
    assert.equal(rows[0].recorded.source, "income");
});

test("symbol and signal filters match a partial name", () => {
    const rows = [
        { symbol: "NEARUSDT", side: "LONG", book: "live", monitors: [{ signal: "GAULS", type: "GAULS", env: "V" }], warnings: [] },
        { symbol: "ETHUSDT", side: "LONG", book: "live", monitors: [{ signal: "ROSE", type: "ROSE", env: "V" }], warnings: [] },
    ];
    assert.equal(filterRows(rows, { symbol: "nea" }).length, 1);
    assert.equal(filterRows(rows, { signal: "gau" })[0].symbol, "NEARUSDT");
});

test("recorded pnl adds realized, fee and funding from the monitor", () => {
    const rows = buildPositionView({
        account: "V",
        now,
        connection: "monitor",
        exchangeLoaded: false,
        heartbeatFresh: false,
        exchangePositions: [],
        monitors: [{
            _id: "m",
            env: "V1",
            symbol: "ETHUSDT",
            side: "LONG",
            positionAmt: "1",
            closed: false,
            position: { positionAmt: "2", entryPrice: "100", markPrice: "110" },
            stats: { realizedPnl: 3, commission: -0.4, funding: -0.1 },
        }],
    });
    assert.equal(rows[0].recorded.net, 2.5);
    assert.equal(rows[0].exchangeQty, 2);
});

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
    const shared = buildPositionView({
        account: "B2",
        now,
        connection: "live",
        exchangeLoaded: true,
        exchangePositions: [{ symbol: "ENAUSDT", positionSide: "LONG", positionAmt: "100", entryPrice: "1", markPrice: "1", unRealizedProfit: "0" }],
        monitors: [
            { _id: "f", env: "B2F", symbol: "ENAUSDT", side: "LONG", positionAmt: "100", signal: "GAULS", closed: false },
            { _id: "l", env: "B2L", symbol: "ENAUSDT", side: "LONG", positionAmt: "100", signal: "GAULS", closed: false },
        ],
    });
    assert.equal(shared[0].monitors.length, 2);
    assert.equal(shared[0].warnings.includes("qty-mismatch"), false);
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
    assert.equal(xrp, undefined);
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

test("pubsub notice is only a version marker and a gap keeps the last snapshot", async () => {
    assert.deepEqual(parseNotice(JSON.stringify({
        account: "V",
        version: 4,
        at: "2026-10-08T12:00:00Z",
        positions: [{ symbol: "ETHUSDT", api_secret: "leak" }],
        listenKey: "secret",
    })), { account: "V", version: 4, at: "2026-10-08T12:00:00Z" });
    const stored = { version: 2, positions: [{ symbol: "BTCUSDT" }] };
    assert.equal(decideUpdate(stored, { version: 5 }, stored).action, "reread");
    assert.equal(decideUpdate(stored, { version: 5 }, null).action, "keep");
    assert.equal(decideUpdate({ version: 3 }, null, { version: 3, positions: [{ symbol: "BTCUSDT" }] }).action, "same");
    assert.equal(decideUpdate({ version: 3 }, null, { version: 4, positions: [{ symbol: "BTCUSDT" }] }).action, "send");

    resetLive();
    let version = 4;
    let handler = null;
    const subs = [];
    bindRedis({
        isReady: true,
        async get() {
            return JSON.stringify({
                version,
                at: new Date().toISOString(),
                source: "monitor",
                account: "V",
                positions: [{ symbol: "BTCUSDT", positionAmt: "1", positionSide: "LONG", entryPrice: "10", markPrice: "11", unRealizedProfit: "1" }],
                monitors: [],
            });
        },
        duplicate() {
            return {
                on() {},
                async connect() { this.isReady = true; return this; },
                async subscribe(channel, fn) { subs.push(channel); if (channel.startsWith("wb:pos:notify:")) handler = fn; },
                async unsubscribe(channel) { subs.splice(subs.indexOf(channel), 1); },
            };
        },
    });
    const seen = [];
    const stopA = watch("V", (snap) => seen.push(snap));
    const stopB = watch("V", () => {});
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(subs, ["wb:pos:notify:V", "wb:ex:notify:V", "wb:ord:notify:V"]);
    assert.equal(seen.at(-1).version, 4);
    assert.equal(seen.at(-1).positions.length, 1);
    version = 4;
    handler(JSON.stringify({ account: "V", version: 9, positions: [{ api_secret: "leak" }] }));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(seen.at(-1).stale, true);
    assert.equal(seen.at(-1).positions[0].symbol, "BTCUSDT");
    assert.equal(JSON.stringify(seen).includes("leak"), false);
    stopA();
    assert.equal(subs.length, 3);
    stopB();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(subs.length, 0);
    resetLive();
});

test("default audience is mine and paper stays out until asked", async () => {
    const admin = { id: "u1", role: "admin", username: "me", email: "me@x.com", botUsernames: ["V"] };
    const originals = { users: UserAccount.find, monitors: MonitorPosition.find, beats: ProcessHeartbeat.find };
    UserAccount.find = () => query([
        { username: "V", accounts: ["V1"], ownerUserId: "other", active: true },
        { username: "OTHER", accounts: ["O1"], ownerUserId: "other", active: true },
        { username: "OFF", accounts: ["F1"], ownerUserId: "u1", active: false },
    ]);
    MonitorPosition.find = () => query([
        { _id: "mine", env: "V1", futuresClientName: "V", symbol: "BTCUSDT", side: "LONG", positionAmt: "1", closed: false },
        { _id: "paper", env: "V1", futuresClientName: "V", symbol: "ETHUSDT", side: "LONG", positionAmt: "2", isPaper: true, closed: false },
        { _id: "done", env: "V1", futuresClientName: "V", symbol: "XRPUSDT", side: "SHORT", positionAmt: "1", isClosed: true, closed: false },
        { _id: "other", env: "O1", futuresClientName: "OTHER", symbol: "SOLUSDT", side: "LONG", positionAmt: "1", closed: false },
    ]);
    ProcessHeartbeat.find = () => query([]);
    const deps = { UserAccount, Monitor: MonitorPosition, Heartbeat: ProcessHeartbeat, now };
    try {
        const mine = await loadPositions(admin, {}, deps);
        assert.deepEqual(mine.accounts.map((row) => row.username), ["V"]);
        assert.equal(mine.rows.some((row) => row.symbol === "ETHUSDT"), false);
        assert.equal(mine.rows.some((row) => row.symbol === "SOLUSDT" || row.symbol === "XRPUSDT"), false);
        const paper = await loadPositions(admin, { book: "paper" }, deps);
        assert.deepEqual(paper.rows.map((row) => row.symbol), ["ETHUSDT"]);
        const all = await loadPositions(admin, { audience: "all", book: "all" }, deps);
        assert.deepEqual(all.accounts.map((row) => row.username), ["V", "OTHER"]);
        assert.equal(all.rows.some((row) => row.account === "OTHER"), true);
        const closed = buildPositionView({
            account: "V",
            exchangeLoaded: true,
            exchangePositions: [],
            monitors: [
                { _id: "stale", env: "V1", symbol: "BNBUSDT", side: "LONG", positionAmt: "1", position: { positionAmt: "1" }, closed: false },
                { _id: "shut", env: "V1", symbol: "ADAUSDT", side: "LONG", positionAmt: "1", isClosed: true, closed: false },
            ],
        });
        assert.equal(closed.length, 0);
        assert.equal(filterRows([{ book: "paper", symbol: "ETHUSDT", side: "LONG", monitors: [], warnings: [] }], {}).length, 0);
        const resting = { book: "pending", symbol: "ETHUSDT", side: "LONG", monitors: [], warnings: [] };
        assert.equal(filterRows([resting], {}).length, 0);
        assert.equal(filterRows([resting], { book: "all" }).length, 0);
        assert.equal(filterRows([resting], { book: "pending" }).length, 1);
    } finally {
        UserAccount.find = originals.users;
        MonitorPosition.find = originals.monitors;
        ProcessHeartbeat.find = originals.beats;
    }
});

test("a missing exchange book shows the stored monitor instead of closed-on-exchange", async () => {
    const rows = buildPositionView({
        account: "B5",
        now,
        connection: "monitor",
        exchangeLoaded: false,
        monitors: [{
            _id: "eth",
            env: "B5",
            symbol: "ETHUSDT",
            side: "LONG",
            type: "NOTPSL",
            positionAmt: "2",
            closed: false,
            position: { positionAmt: "2", entryPrice: "100", markPrice: "110", unRealizedProfit: "20", leverage: "5", liquidationPrice: "80" },
        }],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].closedOnExchange, undefined);
    assert.equal(rows[0].warnings.includes("closed-on-exchange"), false);
    assert.equal(rows[0].entry, 100);
    assert.equal(rows[0].mark, 110);
    assert.equal(rows[0].exchangeQty, 2);
    assert.equal(rows[0].unrealized, 20);
    assert.equal(rows[0].leverage, 5);
    assert.equal(rows[0].liquidation, 80);

    const originals = { users: UserAccount.find, monitors: MonitorPosition.find, beats: ProcessHeartbeat.find };
    UserAccount.find = () => query([{ username: "B5", accounts: ["B5"], ownerUserId: "u1", active: true }]);
    MonitorPosition.find = () => query([{
        _id: "eth",
        env: "B5",
        futuresClientName: "B5",
        symbol: "ETHUSDT",
        side: "LONG",
        type: "NOTPSL",
        positionAmt: "2",
        closed: false,
        position: { positionAmt: "2", entryPrice: "100", markPrice: "110", unRealizedProfit: "20", leverage: "5", liquidationPrice: "80" },
    }]);
    ProcessHeartbeat.find = () => query([]);
    const actorB5 = { id: "u1", role: "admin", username: "me", email: "me@x.com", botUsernames: ["B5"] };
    const failed = { positions: [], openOrders: [], algoOrders: [], monitors: [], stale: true, status: "stale", error: "Không lấy được snapshot" };
    try {
        const view = await loadPositions(actorB5, { account: "B5" }, {
            UserAccount, Monitor: MonitorPosition, Heartbeat: ProcessHeartbeat, now,
            snapshot: async () => failed,
        });
        assert.equal(view.connection, "stale");
        assert.equal(view.stale, true);
        assert.equal(view.rows[0].symbol, "ETHUSDT");
        assert.equal(view.rows[0].closedOnExchange, undefined);
        assert.equal(view.rows[0].entry, 100);
    } finally {
        UserAccount.find = originals.users;
        MonitorPosition.find = originals.monitors;
        ProcessHeartbeat.find = originals.beats;
    }
});

test("the exchange book lists a live position that has no monitor", async () => {
    const originals = { users: UserAccount.find, monitors: MonitorPosition.find, beats: ProcessHeartbeat.find };
    UserAccount.find = () => query([{ username: "V", accounts: ["V1"], ownerUserId: "u1", active: true }]);
    MonitorPosition.find = () => query([
        { _id: "btc", env: "V1", futuresClientName: "V", symbol: "BTCUSDT", side: "LONG", positionAmt: "1", signal: "ROSE", startTime: "2026-10-01T00:00:00.000Z", closed: false },
        { _id: "gone", env: "V1", futuresClientName: "V", symbol: "XRPUSDT", side: "SHORT", positionAmt: "1", signal: "TITAN", closed: false },
    ]);
    ProcessHeartbeat.find = () => query([]);
    const actorV = { id: "u1", role: "admin", username: "me", email: "me@x.com", botUsernames: ["V"] };
    const deps = { UserAccount, Monitor: MonitorPosition, Heartbeat: ProcessHeartbeat, now };
    try {
        const view = await loadPositions(actorV, { account: "V" }, {
            ...deps,
            snapshot: async () => ({ source: "monitor", status: "live", stale: false, positions: [], monitors: [] }),
            exchange: async () => ({
                source: "rest",
                status: "polling",
                stale: false,
                positions: [
                    { symbol: "BTCUSDT", positionSide: "LONG", positionAmt: "3", entryPrice: "10", markPrice: "12", unRealizedProfit: "6" },
                    { symbol: "SOLUSDT", positionSide: "SHORT", positionAmt: "1", entryPrice: "20", markPrice: "18", unRealizedProfit: "2" },
                ],
                openOrders: [],
                algoOrders: [],
            }),
        });
        const btc = view.rows.find((row) => row.symbol === "BTCUSDT");
        const sol = view.rows.find((row) => row.symbol === "SOLUSDT");
        const xrp = view.rows.find((row) => row.symbol === "XRPUSDT");
        assert.equal(btc.exchangeQty, 3);
        assert.equal(btc.monitors[0].signal, "ROSE");
        assert.equal(btc.monitors[0].openedAt, "2026-10-01T00:00:00.000Z");
        assert.equal(sol.warnings.includes("no-monitor"), true);
        assert.equal(sol.exchangeQty, 1);
        assert.equal(xrp, undefined);
        const failed = await loadPositions(actorV, { account: "V" }, {
            ...deps,
            exchange: async () => { throw new Error("API key không gọi được futures"); },
        });
        assert.equal(failed.exchangeErrors[0].account, "V");
        assert.equal(failed.rows.some((row) => row.closedOnExchange), false);
        assert.equal(failed.rows.some((row) => row.symbol === "SOLUSDT"), false);
    } finally {
        UserAccount.find = originals.users;
        MonitorPosition.find = originals.monitors;
        ProcessHeartbeat.find = originals.beats;
    }
});

test("exchange book cache does not call the exchange twice inside the window", async () => {
    resetExchangeCache();
    let calls = 0;
    const book = await loadExchangeBook("V", {
        now: () => 1_000,
        load: async () => {
            calls += 1;
            return { positions: [{ symbol: "SOLUSDT", positionAmt: "1" }], openOrders: [], algoOrders: [] };
        },
    });
    await loadExchangeBook("V", { now: () => 2_000, load: async () => { calls += 1; return { positions: [] }; } });
    assert.equal(calls, 1);
    assert.equal(book.source, "rest");
    assert.equal(book.positions[0].symbol, "SOLUSDT");
    resetExchangeCache();
});

test("create monitor copies the config and refuses a duplicate", async () => {
    const originals = { users: UserAccount.find, count: MonitorPosition.countDocuments, create: MonitorPosition.create };
    UserAccount.find = () => query([{ username: "V", accounts: ["V1"], ownerUserId: "u1", active: true }]);
    MonitorPosition.countDocuments = async () => 0;
    let saved = null;
    MonitorPosition.create = async (doc) => {
        saved = doc;
        return { ...doc, _id: "new1", startTime: doc.startTime };
    };
    const config = { findOne: () => ({ select: () => ({ lean: async () => ({ trade_config: { LONG_LEVERAGE: 10, MONITOR: true } }) }) }) };
    try {
        const created = await createMonitorRecord(actor, { env: "V1", symbol: "nearusdt", side: "LONG", signal: "NOTPSL", positionAmt: "5" }, {
            UserAccount, Monitor: MonitorPosition, AccountConfig: config,
        });
        assert.equal(created.env, "V1");
        assert.equal(created.account, "V");
        assert.equal(saved.futuresClientName, "V");
        assert.equal(saved.positionAmt, 5);
        assert.equal(saved.type, "NOTPSL");
        MonitorPosition.countDocuments = async () => 1;
        await assert.rejects(
            () => createMonitorRecord(actor, { env: "V1", symbol: "NEARUSDT", side: "LONG" }, { UserAccount, Monitor: MonitorPosition, AccountConfig: config }),
            (error) => error.status === 409
        );
    } finally {
        UserAccount.find = originals.users;
        MonitorPosition.countDocuments = originals.count;
        MonitorPosition.create = originals.create;
    }
});

test("delete removes a monitor in scope and refuses a viewer", async () => {
    const originals = {
        users: UserAccount.find,
        findById: MonitorPosition.findById,
        deleteOne: MonitorPosition.deleteOne,
    };
    const doc = { _id: "m1", env: "V1", futuresClientName: "V", symbol: "BTCUSDT", side: "LONG" };
    UserAccount.find = () => query([{ username: "V", accounts: ["V1"], ownerUserId: "u1", active: true }]);
    MonitorPosition.findById = () => ({ lean: async () => doc });
    let removed = null;
    MonitorPosition.deleteOne = async (filter) => {
        removed = filter;
        return { deletedCount: 1 };
    };
    try {
        const result = await deleteMonitorRecord(actor, "m1", { UserAccount, Monitor: MonitorPosition });
        assert.equal(result.account, "V");
        assert.equal(result.symbol, "BTCUSDT");
        assert.equal(String(removed._id), "m1");
        await assert.rejects(
            () => deleteMonitorRecord({ id: "u1", role: "viewer", username: "me", botUsernames: ["V"] }, "m1", { UserAccount, Monitor: MonitorPosition }),
            (error) => error.status === 403
        );
    } finally {
        UserAccount.find = originals.users;
        MonitorPosition.findById = originals.findById;
        MonitorPosition.deleteOne = originals.deleteOne;
    }
});

test("a fresh exchange book skips the Binance call until it is old or refreshed", async () => {
    const originals = { users: UserAccount.find, monitors: MonitorPosition.find, beats: ProcessHeartbeat.find };
    UserAccount.find = () => query([{ username: "V", accounts: ["V1"], ownerUserId: "u1", active: true }]);
    MonitorPosition.find = () => query([]);
    ProcessHeartbeat.find = () => query([]);
    const actorV = { id: "u1", role: "admin", username: "me", email: "me@x.com", botUsernames: ["V"] };
    const deps = { UserAccount, Monitor: MonitorPosition, Heartbeat: ProcessHeartbeat, now };
    const stored = {
        source: "exchange",
        at: new Date(now).toISOString(),
        positions: [{ symbol: "SOLUSDT", positionSide: "SHORT", positionAmt: "1", entryPrice: "20", markPrice: "18", unRealizedProfit: "2" }],
        openOrders: [],
        algoOrders: [],
    };
    let calls = 0;
    try {
        const kept = await loadPositions(actorV, {}, {
            ...deps,
            snapshots: async () => ({ V: stored }),
            exchange: async () => { calls += 1; throw new Error("không được gọi"); },
        });
        assert.equal(calls, 0);
        assert.equal(kept.rows.some((row) => row.symbol === "SOLUSDT"), true);
        const refreshed = await loadPositions(actorV, { refresh: "1" }, {
            ...deps,
            snapshots: async () => ({ V: stored }),
            exchange: async () => {
                calls += 1;
                return { source: "rest", at: new Date(now).toISOString(), positions: [{ symbol: "ADAUSDT", positionSide: "LONG", positionAmt: "1", entryPrice: "1", markPrice: "1", unRealizedProfit: "0" }], openOrders: [], algoOrders: [] };
            },
        });
        assert.equal(calls, 1);
        assert.equal(refreshed.rows.some((row) => row.symbol === "ADAUSDT"), true);
        calls = 0;
        await loadPositions(actorV, {}, {
            ...deps,
            exchangeMaxAgeMs: 1000,
            snapshots: async () => ({ V: { ...stored, at: new Date(now - 5000).toISOString() } }),
            exchange: async () => {
                calls += 1;
                return { source: "rest", at: new Date(now).toISOString(), positions: [], openOrders: [], algoOrders: [] };
            },
        });
        assert.equal(calls, 1);
        calls = 0;
        const keptAfterFailure = await loadPositions(actorV, {}, {
            ...deps,
            exchangeMaxAgeMs: 1000,
            snapshots: async () => ({ V: { ...stored, at: new Date(now - 5000).toISOString() } }),
            exchange: async () => { calls += 1; throw new Error("sàn lỗi"); },
        });
        assert.equal(calls, 1);
        assert.equal(keptAfterFailure.rows.some((row) => row.symbol === "SOLUSDT"), true);
        assert.equal(keptAfterFailure.rows[0].warnings.includes("stale"), true);
    } finally {
        UserAccount.find = originals.users;
        MonitorPosition.find = originals.monitors;
        ProcessHeartbeat.find = originals.beats;
    }
});

test("live mark updates pnl and leaves exchange qty alone", () => {
    const view = applyLiveMarks([
        {
            symbol: "ETHUSDT",
            side: "LONG",
            entry: 100,
            mark: 110,
            exchangeQty: 2,
            unrealized: 1,
            monitors: [{ ownQty: 1, entry: 100, estimatedPnl: 1 }],
        },
        { symbol: "XRPUSDT", side: "SHORT", entry: 1, mark: 1, exchangeQty: null, closedOnExchange: true, unrealized: null, monitors: [] },
    ], (symbol) => (symbol === "ETHUSDT" ? 130 : null));
    assert.equal(view.priced, true);
    assert.equal(view.rows[0].exchangeQty, 2);
    assert.equal(view.rows[0].mark, 130);
    assert.equal(view.rows[0].unrealized, 60);
    assert.equal(view.rows[0].monitors[0].ownQty, 1);
    assert.equal(view.rows[1].mark, 1);
    assert.equal(view.rows[1].closedOnExchange, true);
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


test("empty exchange snapshots clear live monitors and source age is independent of mark prices", async () => {
    const deps = {
        now,
        UserAccount: { find: () => query([{ username: "V", accounts: ["V1"] }]) },
        Monitor: { find: () => query([{ _id: "open", env: "V1", symbol: "BTCUSDT", side: "LONG", positionAmt: "1" }]) },
        Heartbeat: { find: () => query([]) },
        snapshot: async () => ({ source: "exchange", positions: [], version: 4, at: new Date(now).toISOString() }),
        priceOf: () => 100,
    };
    const empty = await loadPositions(actor, { account: "V" }, deps);
    assert.deepEqual(empty.rows, []);
    assert.equal(empty.stale, false);
    deps.snapshot = async () => ({ source: "exchange", positions: [], version: 5,
        at: new Date(now).toISOString(), reconciledAt: new Date(now - 120_000).toISOString() });
    const aged = await loadPositions(actor, { account: "V" }, deps);
    assert.deepEqual(aged.rows, []);
    assert.equal(aged.stale, true);
    assert.equal(aged.sources[0].version, 5);
    const all = await loadPositions(actor, {}, { ...deps, snapshots: async () => ({ V: await deps.snapshot() }) });
    assert.deepEqual(all.rows, []);
    assert.equal(all.stale, true);
});
