const test = require("node:test");
const assert = require("node:assert/strict");

const {
    CONTEXT_VERSION,
    buildOverviewContext,
    buildRowContext,
    buildDecisionContext,
    mapDomainQuality,
    atrPctFromFrame,
    estimateExpiresAt,
    countSetupsOnSnaps,
} = require("../src/lib/market/market-context");

function makeFrame(overrides = {}) {
    return {
        bias: "long",
        regime: "trending",
        structureBias: "bullish",
        longScore: 70,
        shortScore: 20,
        candleCloseTime: "2026-10-23T12:00:00.000Z",
        quality: { overall: "ready" },
        indicators: { atr14: 500, lastClose: 100000 },
        ...overrides,
    };
}

function makeSnap(symbol, opts = {}) {
    const tf = opts.analysisTf || "1h";
    return {
        symbol,
        qualityOverall: opts.qualityOverall || "ready",
        calculatedAt: "2026-10-23T12:05:00.000Z",
        price: { last: 100, asOf: "2026-10-23T12:04:00.000Z", source: "ticker" },
        timeframes: {
            "4h": opts.btc4h || (symbol === "BTCUSDT" ? makeFrame() : null),
            "1h": opts.frame1h || makeFrame({ structureBias: opts.structureBias || "bullish" }),
        },
        composites: {
            intraday: {
                lean: "lean_long",
                conflict: opts.conflict || false,
                eligible: true,
                compositeLong: 65,
                compositeShort: 25,
                status: "lean_long",
            },
        },
        locationByTimeframe: {
            [tf]: {
                timeframe: tf,
                quality: "ready",
                structureBias: opts.structureBias || "bullish",
                structureLabel: "Tăng",
                htfBias: opts.htfBias || "bullish",
                htfLabel: "Tăng",
                price: 100,
                priceAsOf: "2026-10-23T12:04:00.000Z",
                priceFresh: opts.priceFresh !== false,
                candleCloseTime: "2026-10-23T12:00:00.000Z",
                calculatedAt: "2026-10-23T12:05:00.000Z",
                positionTags: opts.positionTags || ["near_support"],
                confirmations: [{ id: "structure", label: "Tăng" }],
                support: {
                    low: 98,
                    high: 99,
                    distancePct: 1,
                    distanceAtr: 0.3,
                    nearFar: "near",
                    role: "support",
                },
                resistance: {
                    low: 105,
                    high: 106,
                    distancePct: 5,
                    distanceAtr: 1.5,
                    nearFar: "far",
                    role: "resistance",
                },
                primarySetup: opts.primarySetup || null,
                setups: opts.setups || [],
            },
        },
    };
}

test("mapDomainQuality: ready → fresh; null → missing; không biến thành 0", () => {
    assert.equal(mapDomainQuality("ready").quality, "fresh");
    assert.equal(mapDomainQuality(null).quality, "missing");
    assert.equal(mapDomainQuality("stale").quality, "stale");
    assert.equal(mapDomainQuality("pending").quality, "warming");
    assert.equal(mapDomainQuality("error").quality, "error");
});

test("atrPctFromFrame: thiếu ATR/close → null", () => {
    assert.equal(atrPctFromFrame(null), null);
    assert.equal(atrPctFromFrame({ indicators: { atr14: 10 } }), null);
    assert.equal(atrPctFromFrame(makeFrame()), 0.5);
});

test("overview context: BTC 4h, breadth mẫu số universe, setup counts, brief", () => {
    const longSetup = {
        id: "z1|long|bounce|setup-v1",
        side: "long",
        type: "bounce",
        lifecycle: "active",
        entryState: "in_entry",
        entryLow: 98,
        entryHigh: 99,
        createdAt: "2026-10-23T10:00:00.000Z",
        createdIndex: 10,
        expiresAtIndex: 22,
        invalidationLevel: 97,
        reasons: ["bounce trên support"],
        touchEvidence: "closed_candle",
    };
    const snaps = [
        makeSnap("BTCUSDT", { setups: [longSetup], primarySetup: longSetup }),
        makeSnap("ETHUSDT", {
            qualityOverall: "pending",
            setups: [],
            primarySetup: null,
        }),
        makeSnap("SOLUSDT", {
            setups: [
                {
                    id: "z2|short|breakout_retest|setup-v1",
                    side: "short",
                    type: "breakout_retest",
                    lifecycle: "active",
                    entryState: "awaiting_entry",
                    reasons: ["retest"],
                },
            ],
        }),
    ];
    // ETH chưa scored frames — breadth coverage vẫn dùng total=3
    snaps[1].timeframes = {};
    snaps[1].composites = {};

    const ctx = buildOverviewContext({
        snaps,
        universe: { version: 7, count: 3 },
        analysisTf: "1h",
        breadth: { leanLong: 1, leanShort: 0, conflict: 0, eligible: 1, trending: 1, ranging: 0, transitional: 0 },
        coverage: { total: 3, scored: 2, ready: 2, warming: 0, pending: 1 },
    });

    assert.equal(ctx.version, CONTEXT_VERSION);
    assert.equal(ctx.btc4h.value.symbol, "BTCUSDT");
    assert.equal(ctx.btc4h.value.timeframe, "4h");
    assert.equal(ctx.btc4h.quality, "fresh");
    assert.equal(ctx.breadth.value.universeTotal, 3);
    assert.equal(ctx.breadth.value.missing, 1);
    assert.equal(ctx.breadth.value.leanLong, 1);
    assert.match(ctx.breadth.value.label, /1\/3/);
    assert.match(ctx.breadth.value.label, /1\/3 thiếu/);
    assert.equal(ctx.volatility.value.atrPct, 0.5);
    assert.equal(ctx.setupCounts.value.active, 2);
    assert.equal(ctx.setupCounts.value.inEntry, 1);
    assert.equal(ctx.setupCounts.value.analysisTf, "1h");
    assert.ok(ctx.brief.statements.length >= 2);
    assert.ok(ctx.brief.statements.every((s) => s.refs?.length));
});

test("overview: thiếu BTC → btc4h missing, không chế số", () => {
    const ctx = buildOverviewContext({
        snaps: [makeSnap("ETHUSDT")],
        universe: { version: 1, count: 1 },
        analysisTf: "1h",
        breadth: { leanLong: 0, leanShort: 0, conflict: 0, eligible: 0 },
        coverage: { total: 1, scored: 1 },
    });
    // ETH snap có timeframes.4h null trong makeSnap trừ BTC
    assert.equal(ctx.btc4h.quality, "missing");
    assert.equal(ctx.btc4h.value, null);
    assert.equal(ctx.volatility.quality, "missing");
});

test("breadth không co mẫu số về scored", () => {
    const ctx = buildOverviewContext({
        snaps: [],
        universe: { count: 50 },
        breadth: { leanLong: 10, leanShort: 5, conflict: 2, eligible: 8 },
        coverage: { total: 50, scored: 40 },
    });
    assert.equal(ctx.breadth.value.universeTotal, 50);
    assert.equal(ctx.breadth.value.scored, 40);
    assert.equal(ctx.breadth.value.missing, 10);
    assert.equal(ctx.breadth.value.leanLong, 10);
});

test("row context: waiting + obstacles HTF conflict", () => {
    const setup = {
        id: "a|long|bounce|setup-v1",
        side: "long",
        type: "bounce",
        lifecycle: "active",
        entryState: "awaiting_entry",
        reasons: ["bounce trên support", "cấu trúc bullish"],
        touchEvidence: null,
    };
    const snap = makeSnap("ETHUSDT", {
        structureBias: "bullish",
        htfBias: "bearish",
        primarySetup: setup,
        setups: [setup],
        conflict: true,
    });
    const loc = snap.locationByTimeframe["1h"];
    const row = buildRowContext({
        loc,
        snap,
        composite: snap.composites.intraday,
        flow: { stale: true, collectedAt: "2026-10-23T11:00:00.000Z", bias: "short" },
    });
    assert.ok(row.waiting?.text);
    assert.match(row.waiting.text, /Chờ/);
    assert.ok(row.obstacles.some((o) => o.id === "htf_conflict" || o.id === "setup_htf"));
    assert.ok(row.obstacles.some((o) => o.id === "score_conflict"));
    assert.ok(row.obstacles.some((o) => o.id === "flow_stale"));
    assert.equal(row.trigger.type, "bounce");
});

test("decisionContext: Long + Short scenarios độc lập; chưa setup hợp lệ", () => {
    const longS = {
        id: "z|long|bounce|setup-v1",
        side: "long",
        type: "bounce",
        lifecycle: "active",
        entryState: "in_entry",
        entryLow: 98,
        entryHigh: 99,
        invalidationLevel: 97,
        expiresAtIndex: 22,
        createdAt: "2026-10-23T10:00:00.000Z",
        createdIndex: 10,
        reasons: ["bounce"],
        touchEvidence: "closed_candle",
        version: "setup-v1",
    };
    const shortS = {
        id: "z|short|breakout_retest|setup-v1",
        side: "short",
        type: "breakout_retest",
        lifecycle: "active",
        entryState: "awaiting_entry",
        entryLow: 105,
        entryHigh: 106,
        invalidationLevel: 107,
        expiresAtIndex: 30,
        createdAt: "2026-10-23T09:00:00.000Z",
        createdIndex: 8,
        reasons: ["retest"],
        version: "setup-v1",
    };
    const snap = makeSnap("ETHUSDT", { setups: [longS, shortS], primarySetup: longS });
    const loc = snap.locationByTimeframe["1h"];
    const dc = buildDecisionContext({
        snap,
        loc,
        composite: snap.composites.intraday,
        frame: snap.timeframes["1h"],
        flow: null,
        analysisTf: "1h",
        setups: [longS, shortS],
    });
    assert.equal(dc.scenarios.length, 2);
    assert.equal(dc.scenarios[0].side, "long");
    assert.equal(dc.scenarios[1].side, "short");
    assert.equal(dc.scenarios[0].invalidationLevel, 97);
    assert.match(dc.scenarios[0].entryNote, /không phải fill/);
    assert.ok(dc.evidence.length >= 1);
    assert.ok(dc.evidence.length <= 3);
    assert.ok(dc.conflicts.length <= 3);

    const empty = buildDecisionContext({
        snap,
        loc: { ...loc, primarySetup: null, setups: [], confirmations: [] },
        composite: null,
        frame: null,
        flow: null,
        analysisTf: "1h",
        setups: [],
    });
    assert.equal(empty.scenarios.length, 0);
    assert.match(empty.note, /Chưa có setup/);
});

test("estimateExpiresAt từ createdAt + bars", () => {
    const iso = estimateExpiresAt(
        {
            createdAt: "2026-10-23T10:00:00.000Z",
            createdIndex: 10,
            expiresAtIndex: 12,
        },
        "1h"
    );
    assert.equal(iso, "2026-10-23T12:00:00.000Z");
});

test("countSetupsOnSnaps không đếm invalidated", () => {
    const snaps = [
        makeSnap("A", {
            setups: [
                { lifecycle: "active", entryState: "in_entry" },
                { lifecycle: "invalidated", entryState: "in_entry" },
                { lifecycle: "expired", entryState: "awaiting_entry" },
            ],
        }),
    ];
    const c = countSetupsOnSnaps(snaps, "1h");
    assert.equal(c.active, 1);
    assert.equal(c.inEntry, 1);
});
