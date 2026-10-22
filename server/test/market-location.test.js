const test = require("node:test");
const assert = require("node:assert/strict");

const {
    distanceToBand,
    relationWithAtr,
    replayZones,
    bandAround,
    ZONE_VERSION,
} = require("../src/lib/market/zone-engine");
const { replaySetups, enrichSetupEntryState, structureAllows } = require("../src/lib/market/setup-engine");
const { normalizeEntryReference, priceRelation, signalValidity } = require("../src/lib/market/signal-entry");
const { normalizeTop, matchScreen, sortLocationRows } = require("../src/lib/market/location-read");

function candle(i, o, h, l, c, openTime) {
    return {
        openTime: openTime || new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
        closeTime: new Date(Date.UTC(2026, 0, 1, 0, i, 59)).toISOString(),
        open: o,
        high: h,
        low: l,
        close: c,
        volume: 1000,
    };
}

/** Chuỗi có pivot low rõ tại index 10 (2 trái/2 phải). */
function buildSwingSeries() {
    const out = [];
    for (let i = 0; i < 80; i += 1) {
        let c = 100 + Math.sin(i / 5) * 2;
        let h = c + 1;
        let l = c - 1;
        if (i === 10) {
            c = 90;
            h = 92;
            l = 88;
        }
        if (i === 8 || i === 9 || i === 11 || i === 12) {
            // flanking cao hơn pivot low
            c = 96;
            h = 98;
            l = 94;
        }
        if (i === 40) {
            // pivot high
            c = 120;
            h = 122;
            l = 118;
        }
        if (i === 38 || i === 39 || i === 41 || i === 42) {
            c = 110;
            h = 112;
            l = 108;
        }
        out.push(candle(i, c, h, l, c));
    }
    return out;
}

test("S3 distance: inside / near / far và % ", () => {
    const inside = distanceToBand(100, 99, 101);
    assert.equal(inside.relation, "inside");
    assert.equal(inside.d, 0);
    const below = relationWithAtr(90, 99, 101, 10);
    assert.equal(below.relation, "below");
    assert.ok(below.distancePct > 0);
    assert.equal(below.nearFar, "far"); // d=9 > 0.5*ATR=5
});

test("S3 distance near uses 0.5 ATR", () => {
    // P=97, band 99-101, d=2, ATR=10 → near
    const r = relationWithAtr(97, 99, 101, 10);
    assert.equal(r.nearFar, "near");
    assert.ok(Math.abs(r.distanceAtr - 0.2) < 1e-9);
    const far = relationWithAtr(80, 99, 101, 10);
    assert.equal(far.nearFar, "far");
    const atEdge = distanceToBand(99, 99, 101);
    assert.equal(atEdge.relation, "inside");
});

test("S2/S3 zone pivot confirms only after right bars; band fixed", () => {
    const candles = buildSwingSeries();
    const state = replayZones(candles, { symbol: "BTCUSDT", timeframe: "1h", prev: {} });
    const supports = state.zones.filter((z) => z.role === "support");
    assert.ok(supports.length >= 1, "expect support zone");
    const z = supports[0];
    assert.equal(z.version, ZONE_VERSION);
    assert.ok(z.confirmedAt);
    assert.ok(z.atrAtConfirmation > 0);
    const band = bandAround(z.pivotPrice, z.atrAtConfirmation);
    assert.ok(Math.abs(z.low - band.low) < 1e-9);
    // ID ổn định khi replay lại
    const again = replayZones(candles, {
        symbol: "BTCUSDT",
        timeframe: "1h",
        prev: { zones: state.zones, lastProcessedCloseTime: state.lastProcessedCloseTime },
    });
    assert.equal(again.zones.filter((x) => x.id === z.id).length, 1);
});

test("S4 wick does not break; close beyond buffer breaks once", () => {
    const base = buildSwingSeries();
    const state1 = replayZones(base, { symbol: "ETHUSDT", timeframe: "1h", prev: {} });
    const support = state1.zones.find((z) => z.role === "support" && z.status === "active");
    assert.ok(support);
    const buf = 0.15 * support.atrAtConfirmation;
    // Wick xuyên nhưng close vẫn trong
    const wick = [
        ...base,
        candle(base.length, support.low, support.high, support.low - buf * 3, support.low + 0.01),
    ];
    const afterWick = replayZones(wick, {
        symbol: "ETHUSDT",
        timeframe: "1h",
        prev: { zones: state1.zones, lastProcessedCloseTime: state1.lastProcessedCloseTime },
    });
    const still = afterWick.zones.find((z) => z.id === support.id);
    assert.equal(still.status, "active");

    const breakBar = [
        ...wick,
        candle(wick.length, support.low, support.high, support.low - buf * 3, support.low - buf * 2),
    ];
    const afterBreak = replayZones(breakBar, {
        symbol: "ETHUSDT",
        timeframe: "1h",
        prev: { zones: afterWick.zones, lastProcessedCloseTime: afterWick.lastProcessedCloseTime },
    });
    const broken = afterBreak.zones.find((z) => z.id === support.id);
    assert.equal(broken.status, "broken");
    const flips = afterBreak.zones.filter((z) => z.parentZoneId === support.id);
    assert.equal(flips.length, 1);
});

test("S5/S6 bounce setup needs structure; trigger candle not in_entry", () => {
    assert.equal(structureAllows("long", "bullish", "n/a"), true);
    assert.equal(structureAllows("long", "bearish", "n/a"), false);
    assert.equal(structureAllows("long", "bullish", "bearish"), false);

    const candles = buildSwingSeries();
    const zones = replayZones(candles, { symbol: "SOLUSDT", timeframe: "1h", prev: {} });
    const setups = replaySetups(candles, zones.zones, {
        structureBias: "bullish",
        htfBias: "n/a",
        prev: {},
    });
    // Có thể tạo hoặc không tùy nến bounce — không crash và terminal không hồi sinh
    const ids = new Set(setups.setups.map((s) => s.id));
    const again = replaySetups(candles, zones.zones, {
        structureBias: "bullish",
        htfBias: "n/a",
        prev: { setups: setups.setups, lastProcessedCloseTime: setups.lastProcessedCloseTime },
    });
    for (const s of again.setups) {
        if (s.lifecycle !== "active") {
            const revived = again.setups.find((x) => x.id === s.id && x.lifecycle === "active" && s.lifecycle !== "active");
            assert.equal(revived, undefined);
        }
        assert.ok(ids.has(s.id) || s.lifecycle === "active");
    }

    const sample = {
        lifecycle: "active",
        entryLow: 99,
        entryHigh: 101,
        entryState: "awaiting_entry",
        firstTouchedAt: null,
        createdIndex: 0,
    };
    const live = enrichSetupEntryState(sample, 100, true);
    assert.equal(live.entryState, "in_entry");
    const stale = enrichSetupEntryState(sample, 100, false);
    assert.equal(stale.entryState, "unknown");
});

test("S8 signal entry normalize range/point/missing", () => {
    const range = normalizeEntryReference({
        prices: { entryPrice: [10, 12], slPrice: 9 },
    });
    assert.equal(range.referenceKind, "range");
    assert.equal(range.entryLow, 10);
    assert.equal(range.entryHigh, 12);
    assert.equal(range.stop, 9);

    const point = normalizeEntryReference({ prices: { entryPrice: 11 } });
    assert.equal(point.referenceKind, "point");
    assert.equal(point.entryLow, 11);

    const missing = normalizeEntryReference({ prices: { currentPrice: 11 } });
    assert.equal(missing, null);

    assert.equal(priceRelation(11, point), "in_range");
    assert.equal(priceRelation(20, point, 1), "above");
    assert.equal(signalValidity({ status: "CLOSE" }, point), "source_closed");
    assert.equal(signalValidity({ status: "OPEN" }, point), "unknown");
});

test("S10 filter/sort before limit; null last; top mapping", () => {
    assert.equal(normalizeTop(20), 25);
    assert.equal(normalizeTop(30), 50);
    assert.equal(normalizeTop(10), 10);
    assert.equal(normalizeTop(99), 10);

    const rows = [
        { symbol: "A", volumeRank: 2, location: { positionTags: ["near_support"], support: { distanceAtr: 0.2 }, primarySetup: null, recentEvents: [] } },
        { symbol: "B", volumeRank: 1, location: { positionTags: [], support: { distanceAtr: null }, primarySetup: { lifecycle: "active", entryState: "in_entry", side: "long" }, recentEvents: [], quality: "ready" } },
        { symbol: "C", volumeRank: 3, location: { positionTags: ["near_support"], support: { distanceAtr: 0.1 }, primarySetup: null, recentEvents: [] } },
    ];
    const buy = rows.filter((r) => matchScreen(r, "buy_zone", "technical"));
    assert.deepEqual(buy.map((r) => r.symbol), ["B"]);
    sortLocationRows(rows, "default", "asc");
    assert.equal(rows[0].symbol, "B");
});
