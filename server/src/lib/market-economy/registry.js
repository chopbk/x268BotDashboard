/**
 * Metric registry — allowlist series/units for economy context.
 * Actual/consensus release mapping intentionally empty in P0 (schedule-only).
 */
const YIELD_TENORS = Object.freeze([
    { id: "us.yield.3m", seriesId: "DGS3MO", label: "US 3M", tenor: "3M" },
    { id: "us.yield.2y", seriesId: "DGS2", label: "US 2Y", tenor: "2Y" },
    { id: "us.yield.5y", seriesId: "DGS5", label: "US 5Y", tenor: "5Y" },
    { id: "us.yield.10y", seriesId: "DGS10", label: "US 10Y", tenor: "10Y" },
    { id: "us.yield.30y", seriesId: "DGS30", label: "US 30Y", tenor: "30Y" },
]);

const CRYPTO_METRICS = Object.freeze([
    {
        id: "crypto.btc_dominance",
        unit: "percent",
        source: "coingecko",
        frequency: "intraday",
        label: "BTC.D",
    },
    {
        id: "crypto.eth_dominance",
        unit: "percent",
        source: "coingecko",
        frequency: "intraday",
        label: "ETH.D",
    },
    {
        id: "crypto.total_market_cap",
        unit: "usd",
        source: "coingecko",
        frequency: "intraday",
        label: "Total market cap",
    },
    {
        id: "crypto.total_volume",
        unit: "usd",
        source: "coingecko",
        frequency: "intraday",
        label: "Total volume 24h",
    },
    {
        id: "crypto.fear_greed",
        unit: "index",
        source: "alternative.me",
        frequency: "daily",
        label: "Fear & Greed",
    },
]);

const METRICS = Object.freeze({
    ...Object.fromEntries(
        YIELD_TENORS.map((y) => [
            y.id,
            {
                id: y.id,
                unit: "percent",
                source: "fred",
                sourceSeriesId: y.seriesId,
                frequency: "business_daily",
                label: y.label,
                tenor: y.tenor,
                kind: "yield",
            },
        ])
    ),
    "us.yield.spread_10y_2y": {
        id: "us.yield.spread_10y_2y",
        unit: "basis_point",
        source: "derived",
        sourceSeriesId: "DGS10-DGS2",
        frequency: "business_daily",
        label: "10Y−2Y",
        kind: "spread",
        deriveFrom: ["us.yield.10y", "us.yield.2y"],
    },
    "us.vix.close": {
        id: "us.vix.close",
        unit: "index",
        source: "fred",
        sourceSeriesId: "VIXCLS",
        frequency: "business_daily",
        label: "VIX close",
        kind: "vix",
        note: "Daily close; not BTC IV",
    },
    ...Object.fromEntries(CRYPTO_METRICS.map((m) => [m.id, { ...m, kind: "crypto" }])),
});

/** Release actual mapping — empty until period/unit/vintage verified (P0 schedule-only). */
const RELEASE_ACTUAL_MAPPING = Object.freeze({});

function getMetric(id) {
    return METRICS[id] || null;
}

function isSeriesAllowed(metricId) {
    return Boolean(METRICS[metricId]);
}

function listYieldTenors() {
    return YIELD_TENORS.slice();
}

function listFredSeriesIds() {
    return [...YIELD_TENORS.map((y) => y.seriesId), "VIXCLS"];
}

module.exports = {
    METRICS,
    YIELD_TENORS,
    CRYPTO_METRICS,
    RELEASE_ACTUAL_MAPPING,
    getMetric,
    isSeriesAllowed,
    listYieldTenors,
    listFredSeriesIds,
};
