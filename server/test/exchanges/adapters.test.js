const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
    migrateExchangeBook,
    canonicalizePosition,
    positionIdentity,
    roundContractsDown,
    floorToStep,
} = require("../../src/lib/exchanges/normalizers");
const { resetExchangeQueuesForTests, enqueueExchangeRest, queueKey } = require("../../src/lib/exchanges/rate-limiters");
const { BybitLinearAdapter } = require("../../src/lib/exchanges/bybit-linear-adapter");
const { AsterFuturesAdapter } = require("../../src/lib/exchanges/aster-futures-adapter");
const { OkxSwapAdapter } = require("../../src/lib/exchanges/okx-swap-adapter");
const { BinanceFuturesAdapter } = require("../../src/lib/exchanges/binance-futures-adapter");
const { capabilitiesForExchange, createAdapterFromApi } = require("../../src/lib/exchanges/factory");
const { buildPositionView, samePosition, exchangeIdentity, monitorIdentity } = require("../../src/lib/positions");
const { CATEGORIES, sanitizeErrorMessage } = require("../../src/lib/exchanges/errors");

function mockFetch(handler) {
    return async (url, opts = {}) => handler(String(url), opts);
}

test("Binance adapter snapshot normalizes canonical + legacy fields", async () => {
    const fetchImpl = mockFetch(async (url) => {
        if (url.includes("positionRisk")) {
            return {
                ok: true,
                json: async () => [{
                    symbol: "BTCUSDT",
                    positionAmt: "0.01",
                    positionSide: "LONG",
                    entryPrice: "60000",
                    markPrice: "61000",
                    unRealizedProfit: "10",
                    leverage: "5",
                    marginType: "cross",
                }],
                headers: { get: () => null },
            };
        }
        if (url.includes("openAlgoOrders")) {
            return { ok: true, json: async () => [], headers: { get: () => null } };
        }
        if (url.includes("openOrders")) {
            return { ok: true, json: async () => [], headers: { get: () => null } };
        }
        return { ok: true, json: async () => ({}), headers: { get: () => null } };
    });
    const adapter = new BinanceFuturesAdapter({
        account: "DEMO",
        apiKey: "k",
        apiSecret: "s",
        fetchImpl,
    });
    const snap = await adapter.getSnapshot({ liveOnly: true });
    assert.equal(snap.exchange, "binance");
    assert.equal(snap.positions[0].instrumentId, "BTCUSDT");
    assert.equal(snap.positions[0].quantityUnit, "base");
    assert.equal(snap.positions[0].side, "LONG");
    assert.ok(Array.isArray(snap.conditionalOrders));
    assert.ok(adapter.capabilities().close);
});

test("Bybit snapshot maps Buy/Sell and preserves positionIdx", async () => {
    const fetchImpl = mockFetch(async (url) => {
        if (url.includes("/v5/position/list")) {
            return {
                ok: true,
                json: async () => ({
                    retCode: 0,
                    result: {
                        list: [{
                            symbol: "BTCUSDT",
                            side: "Buy",
                            size: "0.05",
                            avgPrice: "60000",
                            markPrice: "60100",
                            unrealisedPnl: "5",
                            leverage: "10",
                            positionIdx: 1,
                            positionValue: "3000",
                        }],
                    },
                }),
                headers: { get: () => null },
            };
        }
        if (url.includes("/v5/order/realtime")) {
            return {
                ok: true,
                json: async () => ({ retCode: 0, result: { list: [] } }),
                headers: { get: () => null },
            };
        }
        return { ok: true, json: async () => ({ retCode: 0, result: {} }), headers: { get: () => null } };
    });
    const adapter = new BybitLinearAdapter({ account: "BY1", apiKey: "k", apiSecret: "s", fetchImpl });
    const snap = await adapter.getSnapshot();
    assert.equal(snap.exchange, "bybit");
    assert.equal(snap.positions[0].side, "LONG");
    assert.equal(snap.positions[0].positionIdx, 1);
    assert.equal(snap.positions[0].instrumentId, "BTCUSDT");
    assert.equal(adapter.capabilities().close, false);
});

test("Aster snapshot read-only and does not enable mutation caps", async () => {
    const fetchImpl = mockFetch(async (url) => {
        if (url.includes("positionRisk")) {
            return {
                ok: true,
                json: async () => [{
                    symbol: "ETHUSDT",
                    positionAmt: "-2",
                    positionSide: "BOTH",
                    entryPrice: "3000",
                    markPrice: "2900",
                    unRealizedProfit: "200",
                }],
                headers: { get: () => null },
            };
        }
        if (url.includes("openOrders") || url.includes("openAlgoOrders")) {
            return { ok: true, json: async () => [], headers: { get: () => null } };
        }
        return { ok: true, json: async () => ({}), headers: { get: () => null } };
    });
    const adapter = new AsterFuturesAdapter({ account: "AS1", apiKey: "k", apiSecret: "s", fetchImpl });
    const snap = await adapter.getSnapshot();
    assert.equal(snap.exchange, "aster");
    assert.equal(snap.positions[0].side, "SHORT");
    assert.equal(adapter.capabilities().open, false);
    assert.equal(adapter.capabilities().tpsl, false);
});

test("OKX keeps instId and converts contracts via ctVal", async () => {
    const fetchImpl = mockFetch(async (url, opts) => {
        assert.ok(!JSON.stringify(opts.headers || {}).toLowerCase().includes("secret"));
        if (url.includes("/public/instruments")) {
            return {
                ok: true,
                json: async () => ({
                    code: "0",
                    data: [{ instId: "BTC-USDT-SWAP", ctVal: "0.01", ctMult: "1", lotSz: "1", tickSz: "0.1" }],
                }),
                headers: { get: () => null },
            };
        }
        if (url.includes("/account/positions")) {
            return {
                ok: true,
                json: async () => ({
                    code: "0",
                    data: [{
                        instId: "BTC-USDT-SWAP",
                        pos: "3",
                        posSide: "long",
                        avgPx: "60000",
                        markPx: "60100",
                        upl: "3",
                        lever: "5",
                        mgnMode: "cross",
                    }],
                }),
                headers: { get: () => null },
            };
        }
        if (url.includes("orders-pending") || url.includes("orders-algo-pending")) {
            return { ok: true, json: async () => ({ code: "0", data: [] }), headers: { get: () => null } };
        }
        return { ok: true, json: async () => ({ code: "0", data: [] }), headers: { get: () => null } };
    });
    const adapter = new OkxSwapAdapter({
        account: "OK1",
        apiKey: "k",
        apiSecret: "s",
        password: "pp",
        fetchImpl,
    });
    const snap = await adapter.getSnapshot();
    const pos = snap.positions[0];
    assert.equal(pos.instrumentId, "BTC-USDT-SWAP");
    assert.equal(pos.symbol, "BTC-USDT-SWAP");
    assert.equal(pos.quantityUnit, "contracts");
    assert.equal(pos.quantity, "3");
    assert.equal(pos.baseQuantity, "0.03");
    assert.equal(String(pos.symbol).includes("USDT") && !pos.symbol.includes("-"), false);

    const rounded = adapter.roundCloseContracts(3, 50, { stepSize: "1" });
    assert.equal(rounded, "1");
});

test("OKX partial close rounds down by contract step", () => {
    assert.equal(roundContractsDown(1.9, 1), "1");
    assert.equal(floorToStep(0.4, 1), null);
    assert.equal(roundContractsDown(0.5, 1), null);
});

test("Bybit hedge positionIdx ambiguity is rejected", () => {
    const adapter = new BybitLinearAdapter({ account: "BY1", apiKey: "k", apiSecret: "s" });
    assert.throws(() => adapter.assertPositionIdx({}), /positionIdx/);
});

test("rate limiter queues are separated by exchange + account", async () => {
    resetExchangeQueuesForTests();
    const order = [];
    const a = enqueueExchangeRest("bybit", "A", async () => { order.push("bybit-A"); return 1; });
    const b = enqueueExchangeRest("okex", "A", async () => { order.push("okex-A"); return 2; });
    await Promise.all([a, b]);
    assert.equal(queueKey("bybit", "A"), "bybit:A");
    assert.equal(queueKey("okex", "A"), "okex:A");
    assert.deepEqual(order.sort(), ["bybit-A", "okex-A"]);
});

test("legacy Binance Redis snapshot still migrates; non-Binance missing exchange is stale", () => {
    const legacy = {
        source: "exchange",
        account: "DEMO",
        positions: [{ symbol: "BTCUSDT", positionAmt: "1", positionSide: "LONG" }],
        openOrders: [],
        algoOrders: [{ symbol: "BTCUSDT", algoId: "9", type: "STOP_MARKET" }],
    };
    const ok = migrateExchangeBook(legacy, { accountExchange: "binance" });
    assert.equal(ok.ok, true);
    assert.equal(ok.book.exchange, "binance");
    assert.equal(ok.book.conditionalOrders.length, 1);
    assert.equal(ok.book.algoOrders.length, 1);

    const bad = migrateExchangeBook({ ...legacy, exchange: undefined }, { accountExchange: "bybit" });
    assert.equal(bad.ok, false);
    assert.equal(bad.needsReconcile, true);
});

test("same symbol on different exchanges do not merge", () => {
    const binance = exchangeIdentity({ exchange: "binance", symbol: "BTCUSDT", positionSide: "LONG", positionAmt: "1" });
    const bybit = exchangeIdentity({ exchange: "bybit", symbol: "BTCUSDT", positionSide: "LONG", positionAmt: "1" });
    const okx = exchangeIdentity({ exchange: "okex", symbol: "BTC-USDT-SWAP", instrumentId: "BTC-USDT-SWAP", side: "LONG", positionAmt: "3" });
    assert.equal(samePosition(binance, bybit), false);
    assert.equal(samePosition(binance, okx), false);
    assert.notEqual(positionIdentity({ account: "A", ...binance }), positionIdentity({ account: "A", ...bybit }));

    const rows = buildPositionView({
        account: "A",
        monitors: [],
        exchangePositions: [
            { exchange: "binance", symbol: "BTCUSDT", positionSide: "LONG", positionAmt: "1", entryPrice: "1", markPrice: "1" },
            { exchange: "bybit", symbol: "BTCUSDT", positionSide: "LONG", positionAmt: "2", entryPrice: "1", markPrice: "1" },
        ],
        exchangeLoaded: true,
    });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].exchange, "binance");
    assert.equal(rows[1].exchange, "bybit");
});

test("unknown monitor exchange does not attach to real exchange position", () => {
    const left = exchangeIdentity({ exchange: "binance", symbol: "ETHUSDT", positionSide: "LONG", positionAmt: "1" });
    const right = monitorIdentity({ symbol: "ETHUSDT", side: "LONG", position: { positionSide: "LONG" } }, null);
    assert.equal(right.exchange, "unknown");
    assert.equal(samePosition(left, right), false);
});

test("capability false is rejected by adapter and factory defaults", async () => {
    assert.equal(capabilitiesForExchange("bybit").close, false);
    assert.equal(capabilitiesForExchange("okex").open, false);
    const adapter = createAdapterFromApi({
        username: "X",
        exchange: "bybit",
        api_key: "k",
        api_secret: "s",
    });
    await assert.rejects(() => adapter.closePosition({ symbol: "BTCUSDT" }), /chưa hỗ trợ|close/i);
});

test("error sanitizer never leaks secrets or passphrase", () => {
    const msg = sanitizeErrorMessage("fail apiKey=abc123 passphrase=sekrit signature=deadbeef");
    assert.equal(msg.includes("abc123"), false);
    assert.equal(msg.includes("sekrit"), false);
    assert.equal(msg.includes("deadbeef"), false);
    assert.ok(CATEGORIES.rate_limit);
});

test("canonicalizePosition does not invent USDT for OKX instId", () => {
    const row = canonicalizePosition({
        exchange: "okex",
        symbol: "BTC-USDT-SWAP",
        instrumentId: "BTC-USDT-SWAP",
        side: "LONG",
        quantity: "3",
        quantityUnit: "contracts",
        baseQuantity: "0.03",
    });
    assert.equal(row.instrumentId, "BTC-USDT-SWAP");
    assert.equal(row.symbol, "BTC-USDT-SWAP");
    assert.equal(row.quantityUnit, "contracts");
});
