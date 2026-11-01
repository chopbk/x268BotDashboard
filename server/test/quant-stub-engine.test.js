const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
    runFixtureStub,
    walkForwardStub,
    blockBootstrapStress,
    ENGINE_CATALOG,
} = require("../src/lib/quant/stub-engine");
const { equalWeight, inverseVol, buildProposal, assertFresh } = require("../src/lib/portfolio/allocation");
const { publicAlgo, microstructureCapabilities } = require("../src/lib/trading/algo-orders");

function bars(n) {
    const out = [];
    let px = 100;
    for (let i = 0; i < n; i += 1) {
        const open = px;
        const close = px + ((i % 3) - 1) * 0.4;
        out.push({
            t: i, open, high: Math.max(open, close) + 0.1, low: Math.min(open, close) - 0.1, close,
            availableAt: i, closeTime: i, openTime: i,
        });
        px = close;
    }
    return out;
}

describe("P5 quant stub engine", () => {
    it("catalog keeps non-parity engines blocked", () => {
        assert.ok(ENGINE_CATALOG.every((e) => e.parityReady === false || e.id === "fixture_stub"));
        assert.equal(ENGINE_CATALOG.find((e) => e.id === "dca_mtf_bt").runnableInLab, false);
    });

    it("deterministic rerun same hash", () => {
        const ds = { id: "d1", checksum: "x", bars: bars(40) };
        const cfg = { warmup: 3, capital: 10000, notional: 100, feeBps: 2 };
        const a = runFixtureStub({ dataset: ds, config: cfg, seed: 1 });
        const b = runFixtureStub({ dataset: ds, config: cfg, seed: 1 });
        assert.equal(a.outputHash, b.outputHash);
    });

    it("future bar change does not rewrite past decisions count path", () => {
        const base = bars(30);
        const a = runFixtureStub({
            dataset: { bars: base },
            config: { warmup: 2, capital: 1000, notional: 50, feeBps: 0 },
            seed: 1,
        });
        const future = [...base, {
            t: 99, open: 999, high: 1000, low: 998, close: 999,
            availableAt: 99, closeTime: 99, openTime: 99,
        }];
        const b = runFixtureStub({
            dataset: { bars: future.slice(0, 30) },
            config: { warmup: 2, capital: 1000, notional: 50, feeBps: 0 },
            seed: 1,
        });
        assert.equal(a.outputHash, b.outputHash);
    });

    it("walk-forward does not optimize on test", () => {
        const wf = walkForwardStub({ bars: bars(120) }, { trainBars: 40, testBars: 20, purge: 5 });
        assert.equal(wf.optimizedOnTest, false);
        assert.ok(wf.folds.length >= 1);
    });

    it("bootstrap stress is sensitivity only", () => {
        const s = blockBootstrapStress([1, -1, 0.5, -0.2, 0.1], { samples: 10, seed: 3 });
        assert.equal(s.quality, "stress_sensitivity_only");
        assert.equal(s.samples.length, 10);
    });
});

describe("P6 allocation + microstructure", () => {
    it("equal and inverse-vol weights", () => {
        const eq = equalWeight(["A", "B"]);
        assert.ok(Math.abs(eq[0].weight - 0.5) < 1e-9);
        const iv = inverseVol([
            { symbol: "A", volatility: 0.1 },
            { symbol: "B", volatility: 0.2 },
        ]);
        assert.ok(iv[0].weight > iv[1].weight);
    });

    it("stale proposal rejected", () => {
        const p = buildProposal({
            method: "equal",
            symbols: ["X", "Y"],
            marketRevision: "1",
        });
        assert.throws(() => assertFresh(p, { marketRevision: "2" }), /stale/);
    });

    it("microstructure unavailable explicit", () => {
        const c = microstructureCapabilities();
        assert.equal(c.orderBook.available, false);
        assert.equal(c.backlog, true);
    });

    it("algo public invariant fills+outstanding <= parent", () => {
        const view = publicAlgo({
            algoId: "a",
            account: "u",
            symbol: "BTCUSDT",
            type: "TWAP",
            parentQuantity: 10,
            filledQty: 3,
            children: [
                { childId: "1", status: "submitted", quantity: 2, filledQty: 0 },
                { childId: "2", status: "filled", quantity: 3, filledQty: 3 },
            ],
            liveExecution: false,
        });
        assert.equal(view.invariant.fillsPlusOutstandingLteParent, true);
    });
});
