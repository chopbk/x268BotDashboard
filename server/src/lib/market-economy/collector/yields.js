/**
 * Collect US yields + VIX from FRED; derive 10Y−2Y on common observation date.
 */
const {
    fetchAllFredSeries,
    buildYieldMetricPayloads,
    buildVixPayload,
    FRED_ATTRIBUTION,
} = require("../providers/fred");
const { mergeMetricObservation } = require("../provenance");
const { spread10y2yBp, commonObservationCurve } = require("../units");
const { YIELD_TENORS } = require("../registry");
const {
    upsertMetricObservation,
    getContextSnapshot,
    saveContextSnapshot,
    getLatestMetrics,
} = require("../store");
const { getMacro } = require("../../market-dash/store");
const { getTickers } = require("../../market-dash/store");

async function collectYields() {
    const attemptAt = new Date();
    const { results, errors } = await fetchAllFredSeries();
    const yieldPartials = buildYieldMetricPayloads(results);
    const vixPartial = buildVixPayload(results);

    const prevLatest = await getLatestMetrics([
        ...YIELD_TENORS.map((y) => y.id),
        "us.vix.close",
        "us.yield.spread_10y_2y",
    ]);

    const metrics = {};
    for (const [id, partial] of Object.entries(yieldPartials)) {
        const prev = prevLatest[id]?.payload || null;
        metrics[id] = mergeMetricObservation(prev, partial, attemptAt);
        await upsertMetricObservation(metrics[id]);
    }
    metrics["us.vix.close"] = mergeMetricObservation(
        prevLatest["us.vix.close"]?.payload || null,
        vixPartial,
        attemptAt
    );
    await upsertMetricObservation(metrics["us.vix.close"]);

    const curve = commonObservationCurve(metrics, YIELD_TENORS.map((y) => y.id));
    const y10 = metrics["us.yield.10y"];
    const y2 = metrics["us.yield.2y"];
    let spreadPartial;
    if (y10?.observationDate && y10.observationDate === y2?.observationDate && y10.value != null && y2.value != null) {
        const bp = spread10y2yBp(y10.value, y2.value);
        spreadPartial = {
            id: "us.yield.spread_10y_2y",
            failed: bp == null,
            value: bp,
            unit: "basis_point",
            source: "derived",
            sourceSeriesId: "DGS10-DGS2",
            frequency: "business_daily",
            label: "10Y−2Y",
            observationDate: y10.observationDate,
            sourceAsOf: y10.observationDate,
            observedAt: y10.observedAt,
            quality: "fresh",
            marketState: "closed",
        };
    } else {
        spreadPartial = {
            id: "us.yield.spread_10y_2y",
            failed: true,
            unit: "basis_point",
            source: "derived",
            sourceSeriesId: "DGS10-DGS2",
            frequency: "business_daily",
            label: "10Y−2Y",
            reason: "no_common_observation_date",
        };
    }
    metrics["us.yield.spread_10y_2y"] = mergeMetricObservation(
        prevLatest["us.yield.spread_10y_2y"]?.payload || null,
        spreadPartial,
        attemptAt
    );
    await upsertMetricObservation(metrics["us.yield.spread_10y_2y"]);

    const macro = await getMacro();
    const tickers = await getTickers();
    const prevSnap = (await getContextSnapshot()) || {};

    const snapshot = {
        ...(prevSnap || {}),
        region: "us",
        generatedAt: attemptAt.toISOString(),
        metrics: {
            ...(prevSnap.metrics || {}),
            ...metrics,
        },
        curve: {
            observationDate: curve.observationDate,
            values: curve.values,
            gaps: curve.gaps,
            tenors: YIELD_TENORS.map((y) => ({
                id: y.id,
                tenor: y.tenor,
                value: curve.values?.[y.id] ?? null,
            })),
        },
        cryptoRefs: buildCryptoRefs(macro, tickers),
        sourceHealth: {
            fred: {
                ok: errors.length === 0,
                errors,
                attribution: FRED_ATTRIBUTION,
                mode: process.env.FRED_API_KEY ? "api" : "csv_graph",
            },
        },
        coverage: {
            status: errors.length ? "partial" : curve.observationDate ? "complete" : "partial",
            reasons: [
                ...(errors.length ? ["fred_partial_errors"] : []),
                ...(!curve.observationDate ? ["yield_curve_no_common_date"] : []),
            ],
        },
    };

    await saveContextSnapshot(snapshot);
    return snapshot;
}

function buildCryptoRefs(macro, tickers) {
    const btc = tickers?.get?.("BTCUSDT") || null;
    const eth = tickers?.get?.("ETHUSDT") || null;
    return {
        btc: btc ? { price: btc.lastPrice, change24h: btc.priceChangePercent, venue: "binance_futures", instrument: "BTCUSDT" } : null,
        eth: eth ? { price: eth.lastPrice, change24h: eth.priceChangePercent, venue: "binance_futures", instrument: "ETHUSDT" } : null,
        btcDominance: macro?.metrics?.btcDominance || (macro?.btcDominance != null ? { value: macro.btcDominance, observedAt: macro.updatedAt } : null),
        ethDominance: macro?.metrics?.ethDominance || (macro?.ethDominance != null ? { value: macro.ethDominance, observedAt: macro.updatedAt } : null),
        totalMarketCap: macro?.metrics?.totalMarketCap || (macro?.totalMarketCap != null ? { value: macro.totalMarketCap, observedAt: macro.updatedAt } : null),
        totalVolume: macro?.metrics?.totalVolume || (macro?.totalVolume != null ? { value: macro.totalVolume, observedAt: macro.updatedAt } : null),
        fearGreed: macro?.metrics?.fearGreed || (macro?.fearGreed != null ? { value: macro.fearGreed, displayValue: macro.fearGreedLabel, observedAt: macro.updatedAt } : null),
        note: "Số liệu thị trường global USD từ CoinGecko (collector hiện có) — không phải volume Futures Binance USDT.",
    };
}

module.exports = { collectYields, buildCryptoRefs };
