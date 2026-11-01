const crypto = require("crypto");

/**
 * Engine stub deterministic cho Quant Lab khi parity-ready = false.
 * Không gọi sàn, không import trader, không dùng live credentials.
 * Chỉ phục vụ test hash + OOS/walk-forward scaffolding.
 */
function hashPayload(obj) {
    return crypto.createHash("sha256").update(JSON.stringify(obj)).digest("hex");
}

function runFixtureStub({
    dataset,
    config,
    seed = 1,
    codeRevision = "stub-1",
    engineVersion = "fixture_stub.v1",
} = {}) {
    const bars = Array.isArray(dataset?.bars) ? dataset.bars : [];
    const warmup = Number(config?.warmup) || 0;
    const feeBps = Number(config?.feeBps) || 0;
    const decisions = [];
    let equity = Number(config?.capital) || 10000;
    const startEquity = equity;

    for (let i = 0; i < bars.length; i += 1) {
        const bar = bars[i];
        const availableAt = bar.availableAt ?? bar.closeTime ?? bar.t;
        // No-lookahead: chỉ dùng bars[j] với j < i sau warmup; signal ở close → fill next bar
        if (i < warmup) continue;
        if (i + 1 >= bars.length) break;
        const next = bars[i + 1];
        const nextAvailable = next.availableAt ?? next.openTime ?? next.t;
        if (nextAvailable < availableAt) {
            throw new Error("lookahead_violation: next availableAt < signal availableAt");
        }
        const signal = Number(bar.close) > Number(bar.open) ? "long" : "flat";
        if (signal === "flat") continue;
        const entry = Number(next.open);
        const exit = Number(next.close);
        const ret = (exit - entry) / entry;
        const fee = (feeBps / 10000) * 2;
        const pnl = (Number(config?.notional) || 100) * (ret - fee);
        equity += pnl;
        decisions.push({
            signalBar: i,
            fillBar: i + 1,
            availableAt,
            fillAt: nextAvailable,
            side: "LONG",
            entry,
            exit,
            pnl,
        });
    }

    const result = {
        engineId: "fixture_stub",
        engineVersion,
        codeRevision,
        seed,
        configHash: hashPayload({ config, codeRevision, engineVersion }),
        datasetHash: hashPayload({
            id: dataset?.id,
            checksum: dataset?.checksum,
            bars: bars.map((b) => [b.t || b.closeTime, b.open, b.high, b.low, b.close]),
        }),
        trades: decisions.length,
        equityStart: startEquity,
        equityEnd: equity,
        decisions,
        limitations: [
            "stub_only",
            "not_parity_ready_for_live_promotion",
            "ohlc_next_open_fill",
        ],
        parityReady: false,
    };
    result.outputHash = hashPayload({
        configHash: result.configHash,
        datasetHash: result.datasetHash,
        seed,
        equityEnd: result.equityEnd,
        trades: result.trades,
        decisionPnls: decisions.map((d) => d.pnl),
    });
    return result;
}

/**
 * Walk-forward folds theo thời gian — fit chỉ quá khứ (stub: không optimize, chỉ split).
 */
function walkForwardStub(dataset, { trainBars = 50, testBars = 20, purge = 5 } = {}) {
    const bars = Array.isArray(dataset?.bars) ? dataset.bars : [];
    const folds = [];
    let start = 0;
    while (start + trainBars + purge + testBars <= bars.length) {
        const trainEnd = start + trainBars;
        const testStart = trainEnd + purge;
        const testEnd = testStart + testBars;
        const train = runFixtureStub({
            dataset: { ...dataset, bars: bars.slice(start, trainEnd) },
            config: { warmup: 3, capital: 10000, notional: 100, feeBps: 2 },
            seed: start + 1,
        });
        const test = runFixtureStub({
            dataset: { ...dataset, bars: bars.slice(testStart, testEnd) },
            config: { warmup: 3, capital: 10000, notional: 100, feeBps: 2 },
            seed: start + 1,
        });
        folds.push({
            trainRange: [start, trainEnd],
            testRange: [testStart, testEnd],
            purge,
            trainHash: train.outputHash,
            testHash: test.outputHash,
            testEquityEnd: test.equityEnd,
        });
        start += testBars;
    }
    return { folds, method: "walk_forward_time_purge", optimizedOnTest: false };
}

function blockBootstrapStress(returns, { block = 5, samples = 20, seed = 1 } = {}) {
    const rng = mulberry32(seed);
    const out = [];
    if (!returns?.length) return { samples: [], quality: "missing" };
    for (let s = 0; s < samples; s += 1) {
        const path = [];
        while (path.length < returns.length) {
            const i = Math.floor(rng() * Math.max(1, returns.length - block + 1));
            for (let k = 0; k < block && path.length < returns.length; k += 1) {
                path.push(returns[i + k]);
            }
        }
        const sum = path.reduce((a, b) => a + b, 0);
        out.push(sum);
    }
    return {
        samples: out,
        block,
        seed,
        mean: out.reduce((a, b) => a + b, 0) / out.length,
        quality: "stress_sensitivity_only",
        note: "Không cam kết lợi nhuận",
    };
}

function mulberry32(a) {
    return function next() {
        let t = (a += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const ENGINE_CATALOG = [
    {
        id: "fixture_stub",
        parityReady: false,
        runnableInLab: true,
        note: "Deterministic stub for lab plumbing only",
    },
    {
        id: "dca_mtf_bt",
        parityReady: false,
        runnableInLab: false,
        note: "Adapter blocked until parity fixture; see backtest-engines.fixture.json",
    },
    {
        id: "signal_config_bt",
        parityReady: false,
        runnableInLab: false,
        note: "Tied to trader/credentials — never in lab runner",
    },
];

module.exports = {
    runFixtureStub,
    walkForwardStub,
    blockBootstrapStress,
    hashPayload,
    ENGINE_CATALOG,
};
