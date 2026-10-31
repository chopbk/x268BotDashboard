const test = require("node:test");
const assert = require("node:assert/strict");

const {
    computeRr,
    deriveAction,
    deriveOiRegime,
    deriveChanged,
    conflictsShortFromObstacles,
    relativeVsBtc24h,
    buildDecision,
    CHANGED_WINDOW_MS,
} = require("../src/lib/market/decision-list");
const { matchScreen, sortLocationRows } = require("../src/lib/market/location-read");
const { buildRowContext } = require("../src/lib/market/market-context");

function activeLongSetup(over = {}) {
    return {
        id: "z|long|bounce|setup-v1",
        side: "long",
        type: "bounce",
        lifecycle: "active",
        entryState: "in_entry",
        entryLow: 98,
        entryHigh: 99,
        invalidationLevel: 97,
        createdAt: "2026-10-23T10:00:00.000Z",
        touchEvidence: "closed_candle",
        ...over,
    };
}

test("computeRr long: S < E < T → rr hữu hạn; sai hướng → null", () => {
    const ok = computeRr({
        side: "long",
        entryLow: 98,
        entryHigh: 99,
        invalidationLevel: 97,
        resistance: { low: 105, high: 106 },
        support: { low: 90, high: 91 },
    });
    assert.equal(ok.entryUsed, 99);
    assert.equal(ok.targetLevel, 105);
    assert.equal(ok.rr, 3); // (105-99)/(99-97)

    const bad = computeRr({
        side: "long",
        entryLow: 98,
        entryHigh: 99,
        invalidationLevel: 97,
        resistance: { low: 98.5, high: 99 },
    });
    assert.equal(bad.rr, null);
});

test("computeRr short: T < E < S", () => {
    const ok = computeRr({
        side: "short",
        entryLow: 100,
        entryHigh: 101,
        invalidationLevel: 103,
        support: { low: 94, high: 95 },
        resistance: { low: 110, high: 111 },
    });
    assert.equal(ok.entryUsed, 100);
    assert.equal(ok.targetLevel, 95);
    assert.equal(ok.rr, roundish((100 - 95) / (103 - 100)));
});

function roundish(n) {
    return Math.round(n * 100) / 100;
}

test("deriveAction: in_zone / skip HTF / watch gần vùng", () => {
    const locReady = {
        priceFresh: true,
        quality: "ready",
        htfBias: "bullish",
        positionTags: ["in_support"],
    };
    assert.equal(deriveAction({ loc: locReady, setup: activeLongSetup() }).action, "in_zone");

    const skipHtf = deriveAction({
        loc: { ...locReady, htfBias: "bearish" },
        setup: activeLongSetup(),
    });
    assert.equal(skipHtf.action, "skip");
    assert.match(skipHtf.actionReason, /ngược HTF/);

    const watch = deriveAction({
        loc: { priceFresh: true, quality: "ready", positionTags: ["near_support"], htfBias: "bullish" },
        setup: null,
    });
    assert.equal(watch.action, "watch");

    const skipFar = deriveAction({
        loc: { priceFresh: true, quality: "ready", positionTags: [], htfBias: "n/a" },
        setup: null,
    });
    assert.equal(skipFar.action, "skip");
});

test("deriveOiRegime 4 góc + thiếu data", () => {
    assert.equal(deriveOiRegime({ priceChangePct: 2, oiDeltaPct: 3, hasFlow: true }).oiRegime, "new_long");
    assert.equal(deriveOiRegime({ priceChangePct: 2, oiDeltaPct: -3, hasFlow: true }).oiRegime, "covering");
    assert.equal(deriveOiRegime({ priceChangePct: -2, oiDeltaPct: 3, hasFlow: true }).oiRegime, "new_short");
    assert.equal(deriveOiRegime({ priceChangePct: -2, oiDeltaPct: -3, hasFlow: true }).oiRegime, "flush");
    assert.equal(deriveOiRegime({ hasFlow: false }).oiRegimeReason, "flow_unavailable");
    assert.equal(
        deriveOiRegime({ priceChangePct: 2, oiDeltaPct: 3, hasFlow: true, flowStale: true }).oiRegimeReason,
        "flow_stale"
    );
});

test("deriveChanged: setup mới trong 2h", () => {
    const now = Date.parse("2026-10-23T12:00:00.000Z");
    const createdAt = new Date(now - 12 * 60_000).toISOString();
    const hit = deriveChanged({
        setup: activeLongSetup({ createdAt }),
        now,
    });
    assert.equal(hit.kind, "setup_new");
    assert.match(hit.label, /Mới 12p/);

    const old = deriveChanged({
        setup: activeLongSetup({ createdAt: new Date(now - CHANGED_WINDOW_MS - 1000).toISOString() }),
        now,
    });
    assert.equal(old.kind, null);
});

test("conflictsShort ưu tiên HTF rồi Flow", () => {
    const labels = conflictsShortFromObstacles(
        [
            { id: "near_resistance" },
            { id: "flow_vs_setup" },
            { id: "htf_conflict" },
            { id: "price_stale" },
        ],
        []
    );
    assert.deepEqual(labels, ["HTF ngược", "Flow ngược", "Giá cũ"]);
});

test("relativeVsBtc24h = coin − btc", () => {
    assert.equal(relativeVsBtc24h(5, 2), 3);
    assert.equal(relativeVsBtc24h(null, 2), null);
});

test("buildDecision gắn action + rr + oi", () => {
    const loc = {
        priceFresh: true,
        quality: "ready",
        htfBias: "bullish",
        structureBias: "bullish",
        positionTags: ["in_support"],
        support: { low: 98, high: 99, distanceAtr: 0.2, nearFar: "inside" },
        resistance: { low: 105, high: 106, distanceAtr: 1.2, nearFar: "far" },
        recentEvents: [],
    };
    const d = buildDecision({
        loc,
        setup: activeLongSetup(),
        obstacles: [],
        flow: { stale: false, openInterest: { deltaPct: 4 } },
        priceChangePct: 2.5,
        btcChangePct24h: 1,
        canFlowLink: true,
        now: Date.parse("2026-10-23T12:00:00.000Z"),
    });
    assert.equal(d.action, "in_zone");
    assert.equal(d.rr, 3);
    assert.equal(d.oiRegime, "new_long");
    assert.equal(d.relativeVsBtc24h, 1.5);
    assert.equal(d.links.flow, true);
});

test("buildRowContext exposes decision", () => {
    const setup = activeLongSetup();
    const loc = {
        timeframe: "1h",
        quality: "ready",
        priceFresh: true,
        htfBias: "bullish",
        structureBias: "bullish",
        structureLabel: "Tăng",
        positionTags: ["in_support"],
        support: { low: 98, high: 99, distancePct: 0, distanceAtr: 0, nearFar: "inside" },
        resistance: { low: 105, high: 106, distancePct: 5, distanceAtr: 1, nearFar: "far" },
        primarySetup: setup,
        recentEvents: [],
    };
    const ctx = buildRowContext({
        loc,
        snap: { price: { changePct24h: 3 }, composites: { intraday: { conflict: false } } },
        flow: null,
        priceChangePct: 3,
        btcChangePct24h: 1,
    });
    assert.ok(ctx.decision);
    assert.equal(ctx.decision.action, "in_zone");
    assert.equal(ctx.decision.relativeVsBtc24h, 2);
});

test("matchScreen decision_ready / stronger_btc / trend_retest", () => {
    const rowReady = {
        location: { primarySetup: activeLongSetup(), priceFresh: true, quality: "ready", htfBias: "bullish" },
        context: { decision: { action: "in_zone", relativeVsBtc24h: 1.2, conflictsShort: [] } },
    };
    assert.equal(matchScreen(rowReady, "decision_ready", "technical"), true);
    assert.equal(matchScreen(rowReady, "stronger_btc", "technical"), true);

    const retest = {
        location: {
            primarySetup: activeLongSetup({ type: "breakout_retest", entryState: "awaiting_entry" }),
            htfBias: "bullish",
        },
        context: { decision: { action: "wait_confirm" } },
    };
    assert.equal(matchScreen(retest, "trend_retest", "technical"), true);

    const weak = {
        location: { primarySetup: activeLongSetup(), htfBias: "bullish" },
        context: { decision: { action: "skip", relativeVsBtc24h: -1 } },
    };
    assert.equal(matchScreen(weak, "decision_ready", "technical"), false);
    assert.equal(matchScreen(weak, "stronger_btc", "technical"), false);
});

test("sortLocationRows priority: in_zone trước skip", () => {
    const rows = [
        {
            symbol: "AAA",
            volumeRank: 2,
            location: { support: { distanceAtr: 1 } },
            context: { decision: { action: "skip", changed: { kind: null } } },
        },
        {
            symbol: "BBB",
            volumeRank: 1,
            location: { support: { distanceAtr: 0.2 } },
            context: { decision: { action: "in_zone", changed: { kind: "setup_new" } } },
        },
    ];
    sortLocationRows(rows, "default", "asc");
    assert.equal(rows[0].symbol, "BBB");
});
