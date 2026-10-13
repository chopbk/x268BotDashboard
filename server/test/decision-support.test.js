const test = require("node:test");
const assert = require("node:assert/strict");
const { computePositionMetrics, pnlLinear } = require("../src/lib/decision-support/position-metrics");
const { computeAccountMetrics } = require("../src/lib/decision-support/account-metrics");
const { buildPositionScenarios } = require("../src/lib/decision-support/scenarios");
const { validateReport, directionOk } = require("../src/lib/decision-support/validate-report");
const { buildRulesReport, generateAiReport } = require("../src/lib/decision-support/ai-report");
const { buildTechnicalBrief } = require("../src/lib/decision-support/market-snapshot");
const { serializeProfile, isConfigured, normalizeInput } = require("../src/lib/risk-profile");

test("pnlLinear LONG/SHORT đúng chiều", () => {
    assert.equal(pnlLinear("LONG", 100, 90, 2), -20);
    assert.equal(pnlLinear("SHORT", 100, 90, 2), 20);
    assert.equal(pnlLinear("LONG", 100, 110, 1), 10);
});

test("position metrics: thiếu SL + R:R từ mark", () => {
    const m = computePositionMetrics({
        account: "demo",
        symbol: "BTCUSDT",
        side: "LONG",
        entry: 100,
        mark: 110,
        size: 1,
        leverage: 10,
        liquidation: 80,
        exchangeSl: 105,
        exchangeTp: 120,
        unrealized: 10,
    });
    assert.equal(m.riskMarkToSl, -5);
    assert.equal(m.rewardMarkToTp, 10);
    assert.equal(m.rrRemaining, 2);
    assert.equal(m.slBeforeLiq, true);
    // LONG entry 100, SL 105: SL khóa lãi → riskEntryToSl > 0
    assert.ok(m.riskEntryToSl > 0);
});

test("position metrics: SHORT thiếu SL trong missingData", () => {
    const m = computePositionMetrics({
        symbol: "ETHUSDT",
        side: "SHORT",
        entry: 2000,
        mark: 2010,
        size: 2,
    });
    assert.ok(m.missingData.includes("exchange_sl"));
    assert.equal(m.sl, null);
});

test("sibling monitors không double-count notional ở account", () => {
    const row = {
        account: "demo",
        symbol: "BTCUSDT",
        side: "LONG",
        entry: 100,
        mark: 100,
        exchangeQty: 2,
        size: 2,
        unrealized: 0,
        exchangeSl: 95,
        monitors: [
            { env: "A", ownQty: 1 },
            { env: "B", ownQty: 1 },
        ],
    };
    const acct = computeAccountMetrics({
        username: "demo",
        positions: [row],
        wallet: { equity: 1000, available: 800 },
    });
    assert.equal(acct.positionCount, 1);
    assert.equal(acct.grossNotional, 200);
    assert.equal(acct.concentration[0].notional, 200);
});

test("equity ≤0 → insufficient_data hint", () => {
    const acct = computeAccountMetrics({
        username: "demo",
        positions: [],
        wallet: { equity: 0, available: 0 },
    });
    assert.equal(acct.riskLevelHint, "insufficient_data");
    assert.ok(acct.missingData.includes("equity"));
});

test("scenarios tối đa 3 và bỏ khi thiếu mark/qty", () => {
    const empty = buildPositionScenarios({ side: "LONG", mark: null, qty: 1 });
    assert.deepEqual(empty.scenarios, []);
    const m = computePositionMetrics({
        side: "LONG",
        entry: 100,
        mark: 102,
        size: 1,
        exchangeSl: 98,
        exchangeTp: 110,
    });
    const market = {
        atr14: 2,
        candidateLevels: {
            structureSlLong: 97,
            structureTpLong: 108,
            swingLow: 96,
            invalidation: 96,
        },
    };
    const { scenarios } = buildPositionScenarios(m, market);
    assert.ok(scenarios.length <= 3);
    assert.ok(scenarios.some((s) => s.id === "hold_manage"));
    assert.ok(scenarios.some((s) => s.id === "reduce_risk"));
});

test("directionOk từ chối SL LONG trên mark", () => {
    assert.equal(directionOk("LONG", "sl", 100, 105), false);
    assert.equal(directionOk("LONG", "sl", 100, 95), true);
    assert.equal(directionOk("SHORT", "tp", 100, 90), true);
    assert.equal(directionOk("SHORT", "sl", 100, 95), false);
});

test("validateReport loại giá sai chiều và cap qty", () => {
    const snapshot = {
        scope: "position",
        metrics: { side: "LONG", mark: 100, qty: 2, sl: 95, tp: 110 },
        market: {
            levels: [{ price: 95 }, { price: 110 }],
            candidateLevels: { structureSlLong: 94, structureTpLong: 112 },
        },
        scenarios: [{
            id: "reduce_risk",
            title: "Giảm rủi ro",
            candidateLevels: { sl: 94, tp: 112 },
            qtyImpact: { closeQty: 1, remainQty: 1, reducePct: 0.5 },
            riskFromMarkToSl: -6,
        }],
        missingData: [],
        snapshotId: "abc",
        asOf: "2026-01-01T00:00:00.000Z",
    };
    const bad = validateReport({
        summary: "test",
        riskLevel: "attention",
        findings: [],
        scenarios: [{
            id: "reduce_risk",
            title: "Hack",
            candidateLevels: { sl: 120 }, // sai chiều
            qtyImpact: { closeQty: 99, remainQty: 0, reducePct: 1 },
            riskFromMarkToSl: -999,
        }],
        priorities: [{ action: "Siết SL" }],
        missingData: [],
        meta: { source: "ai" },
    }, snapshot);
    assert.equal(bad.meta.source, "ai");
    const sc = bad.scenarios.find((s) => s.id === "reduce_risk");
    assert.ok(sc);
    assert.ok(!sc.candidateLevels?.sl || sc.candidateLevels.sl < 100);
    assert.ok(sc.qtyImpact.closeQty <= 2.02);
    assert.notEqual(sc.riskFromMarkToSl, -999);
});

test("AI JSON lỗi → fallback rules", async () => {
    const snapshot = {
        scope: "position",
        account: "demo",
        metrics: {
            symbol: "BTCUSDT",
            side: "LONG",
            mark: 100,
            qty: 1,
            sl: null,
            missingData: ["exchange_sl"],
        },
        scenarios: [{ id: "hold_manage", title: "Giữ", rationale: "x" }],
        missingData: ["exchange_sl", "risk_profile"],
        riskLevelHint: "high",
        snapshotId: "x",
        asOf: new Date().toISOString(),
    };
    // Force rules path
    const report = await generateAiReport(snapshot, { forceRules: true });
    assert.equal(report.meta.source, "rules");
    assert.ok(report.missingData.includes("risk_profile"));
    assert.match(report.summary, /ngân sách rủi ro|Thiếu|SL|BTC/i);
});

test("buildRulesReport gắn risk_profile missing", () => {
    const raw = buildRulesReport({
        scope: "position",
        metrics: { symbol: "X", side: "LONG", mark: 1, qty: 1, sl: null },
        scenarios: [],
        missingData: ["risk_profile"],
        riskLevelHint: "attention",
    });
    assert.ok(raw.findings.some((f) => /ngân sách rủi ro/i.test(f.title)));
});

test("buildTechnicalBrief và rules có findings kỹ thuật symbol", () => {
    const market = {
        symbol: "BTCUSDT",
        multiTf: "bullish_align",
        alignment: "with",
        atr14: 120,
        tf15: {
            structure: { bias: "bullish", label: "Cấu trúc tăng (HH+HL)" },
            rsi14: 58,
            atr14: 120,
            atrPct: 1.2,
            support: 94000,
            resistance: 98000,
            volumeRel: 1.4,
            trendVsEma: "bullish",
            formingCandle: false,
        },
        tf1h: {
            structure: { bias: "bullish", label: "Cấu trúc tăng (HH+HL)" },
            rsi14: 55,
            support: 93000,
            resistance: 99000,
            trendVsEma: "bullish",
        },
        tf4h: {
            structure: { bias: "bullish", label: "Cấu trúc tăng (HH+HL)" },
            trendVsEma: "bullish",
            rsi14: 52,
        },
        candidateLevels: { invalidation: 93500 },
        levels: [{ id: "sl_atr", role: "sl", price: 94500, label: "SL ATR" }],
    };
    const brief = buildTechnicalBrief(market, { side: "LONG", symbol: "BTCUSDT" });
    assert.ok(brief.headline);
    assert.ok(brief.findings.some((f) => /cấu trúc/i.test(f.title)));
    assert.ok(brief.cards.support === 94000);

    const raw = buildRulesReport({
        scope: "position",
        metrics: { symbol: "BTCUSDT", side: "LONG", mark: 96000, qty: 1, sl: 95000 },
        market,
        technicalBrief: brief,
        scenarios: [],
        missingData: [],
        riskLevelHint: "normal",
    });
    assert.ok(raw.findings.some((f) => /cấu trúc|RSI|hỗ trợ/i.test(f.title)));
    assert.match(raw.summary, /đồng thuận tăng|cùng chiều/i);
});

test("risk profile normalize + isConfigured", () => {
    assert.equal(isConfigured(serializeProfile(null)), false);
    const input = normalizeInput({
        style: "scalp",
        maxLossPerTrade: { value: 50, unit: "usdt" },
        maxSymbolConcentrationPct: 40,
        allowDca: false,
    });
    assert.equal(input.style, "scalp");
    assert.equal(input.maxLossPerTrade.value, 50);
    assert.equal(isConfigured(input), true);
    assert.throws(() => normalizeInput({ style: "moon" }));
});

test("runPositionDecision 403 khi account ngoài scope", async () => {
    const { runPositionDecision } = require("../src/lib/decision-support/run-decision");
    const actor = {
        id: "u1",
        permissions: ["positions.view"],
        permissionScopes: { "positions.view": "own" },
        botUsernames: ["allowed"],
        username: "viewer",
        role: "viewer",
    };
    await assert.rejects(
        () => runPositionDecision(actor, {
            position: { account: "other", symbol: "BTCUSDT", side: "LONG", mark: 1, size: 1 },
            ai: false,
        }),
        (err) => Number(err.statusCode || err.status) === 403
    );
});
