const test = require("node:test");
const assert = require("node:assert/strict");
process.env.WEB_JWT_SECRET = "test-secret-at-least-16-characters";

const SignalInfo = require("../src/models/signal-info");
const { listSignalHistory, sessionId } = require("../src/lib/signal-history");

function query(value) {
    return {
        select() { return this; }, sort() { return this; }, skip() { return this; }, limit() { return this; },
        lean() { return Promise.resolve(value); },
        then(ok, fail) { return Promise.resolve(value).then(ok, fail); },
    };
}

test("signal history lists the system log inside the default 3 day window", async () => {
    const originals = { signal: SignalInfo.find, count: SignalInfo.countDocuments, aggregate: SignalInfo.aggregate };
    let signalFilter;
    SignalInfo.find = (filter) => {
        signalFilter = filter;
        return query([{ _id: "1", signal: "ROSE", symbol: "BTCUSDT", side: "LONG", type: "SCALP", status: "CLOSE", openTime: new Date() }]);
    };
    SignalInfo.countDocuments = async () => 4;
    SignalInfo.aggregate = async () => [{
        bySignalSide: [{ _id: { signal: "ROSE", side: "LONG" }, count: 3 }, { _id: { signal: "BULL", side: "SHORT" }, count: 1 }],
        byType: [{ _id: "SCALP", count: 3 }, { _id: "SWING", count: 1 }],
        bySymbol: [{ _id: "BTCUSDT", count: 2 }, { _id: "ETHUSDT", count: 2 }],
        bySession: [{ _id: "Á", count: 3 }, { _id: "Mỹ", count: 1 }],
    }];
    try {
        const result = await listSignalHistory({ role: "viewer" }, {});
        assert.equal(result.total, 4);
        assert.equal(result.stats.long, 3);
        assert.equal(result.stats.short, 1);
        assert.equal(result.stats.byType[0].type, "SCALP");
        assert.equal(result.stats.bySymbol[0].symbol, "BTCUSDT");
        assert.equal(result.stats.topSession.id, "Á");
        assert.equal(signalFilter.signal, undefined);
        const span = Date.now() - signalFilter.openTime.$gte.getTime();
        assert.ok(span > 2.9 * 24 * 60 * 60 * 1000 && span < 3.1 * 24 * 60 * 60 * 1000);
    } finally {
        SignalInfo.find = originals.signal;
        SignalInfo.countDocuments = originals.count;
        SignalInfo.aggregate = originals.aggregate;
    }
});

test("signal history uses the requested time range and symbol", async () => {
    const originals = { signal: SignalInfo.find, count: SignalInfo.countDocuments, aggregate: SignalInfo.aggregate };
    let signalFilter;
    SignalInfo.find = (filter) => { signalFilter = filter; return query([]); };
    SignalInfo.countDocuments = async () => 0;
    SignalInfo.aggregate = async () => [{ bySignalSide: [], byType: [], bySymbol: [], bySession: [] }];
    try {
        await listSignalHistory({}, {
            from: "2026-10-01T00:00:00.000Z",
            to: "2026-10-04T00:00:00.000Z",
            q: "btc",
        });
        assert.equal(signalFilter.openTime.$gte.toISOString(), "2026-10-01T00:00:00.000Z");
        assert.equal(signalFilter.openTime.$lte.toISOString(), "2026-10-04T00:00:00.000Z");
        assert.match(String(signalFilter.symbol), /btc/i);
    } finally {
        SignalInfo.find = originals.signal;
        SignalInfo.countDocuments = originals.count;
        SignalInfo.aggregate = originals.aggregate;
    }
});

test("signal history filters one signal without hiding the other signal choices", async () => {
    const originals = { signal: SignalInfo.find, count: SignalInfo.countDocuments, aggregate: SignalInfo.aggregate };
    let signalFilter;
    let pipeline;
    SignalInfo.find = (filter) => { signalFilter = filter; return query([]); };
    SignalInfo.countDocuments = async () => 0;
    SignalInfo.aggregate = async (stages) => { pipeline = stages; return [{ bySignalSide: [], byType: [], bySymbol: [], bySession: [], signalOptions: [{ _id: "ROSE", count: 2 }, { _id: "BULL", count: 1 }] }]; };
    try {
        const result = await listSignalHistory({}, { signal: "rose+" });
        assert.equal(signalFilter.signal.source, "^rose\\+$");
        assert.equal(pipeline[0].$match.signal, undefined);
        assert.equal(pipeline[1].$facet.signalOptions[0].$match, undefined);
        assert.equal(pipeline[1].$facet.bySignalSide[0].$match.signal.source, "^rose\\+$");
        assert.deepEqual(result.stats.bySignal.map((item) => item.signal), ["ROSE", "BULL"]);
    } finally {
        SignalInfo.find = originals.signal;
        SignalInfo.countDocuments = originals.count;
        SignalInfo.aggregate = originals.aggregate;
    }
});

test("session hours follow Vietnam time", () => {
    assert.equal(sessionId(7), "Á");
    assert.equal(sessionId(14), "Á");
    assert.equal(sessionId(15), "Âu");
    assert.equal(sessionId(20), "Âu");
    assert.equal(sessionId(21), "Mỹ");
    assert.equal(sessionId(2), "Mỹ");
});
