/**
 * CoinGecko /global + alternative.me Fear & Greed.
 * P0a: per-metric provenance; fallback giữ observedAt cũ (không làm mới tuổi số cũ).
 */
const { saveMacro, getMacro } = require("../store");
const { mergeMetricObservation } = require("../../market-economy/provenance");

const CG_URL = "https://api.coingecko.com/api/v3/global";
const FNG_URL = "https://api.alternative.me/fng/?limit=1";

async function fetchJson(url, timeoutMs = 12_000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            signal: ctrl.signal,
            headers: { accept: "application/json" },
        });
        if (!res.ok) throw new Error(`${url} ${res.status}`);
        return await res.json();
    } finally {
        clearTimeout(t);
    }
}

function legacyFromMetrics(metrics, extras = {}) {
    return {
        btcDominance: metrics.btcDominance?.value ?? null,
        ethDominance: metrics.ethDominance?.value ?? null,
        totalMarketCap: metrics.totalMarketCap?.value ?? null,
        totalVolume: metrics.totalVolume?.value ?? null,
        fearGreed: metrics.fearGreed?.value ?? null,
        fearGreedLabel: extras.fearGreedLabel ?? metrics.fearGreed?.displayValue ?? null,
    };
}

async function collectMacro() {
    const attemptAt = new Date();
    const collectedAt = attemptAt.toISOString();
    const prev = (await getMacro()) || {};
    const prevMetrics = prev.metrics || {};
    const errors = [];
    let fearGreedLabel = prev.fearGreedLabel || null;
    let cgOk = false;
    let fngOk = false;
    let cgSourceAsOf = null;
    let fngSourceAsOf = null;

    const nextPartials = {
        btcDominance: { id: "crypto.btc_dominance", unit: "percent", source: "coingecko", frequency: "intraday", label: "BTC.D", failed: true },
        ethDominance: { id: "crypto.eth_dominance", unit: "percent", source: "coingecko", frequency: "intraday", label: "ETH.D", failed: true },
        totalMarketCap: { id: "crypto.total_market_cap", unit: "usd", source: "coingecko", frequency: "intraday", label: "Total market cap", failed: true },
        totalVolume: { id: "crypto.total_volume", unit: "usd", source: "coingecko", frequency: "intraday", label: "Total volume 24h", failed: true },
        fearGreed: { id: "crypto.fear_greed", unit: "index", source: "alternative.me", frequency: "daily", label: "Fear & Greed", failed: true },
    };

    try {
        const body = await fetchJson(CG_URL);
        const d = body?.data || {};
        cgOk = true;
        cgSourceAsOf = collectedAt;
        const btc = Number(d.market_cap_percentage?.btc);
        const eth = Number(d.market_cap_percentage?.eth);
        const cap = Number(d.total_market_cap?.usd);
        const vol = Number(d.total_volume?.usd);
        nextPartials.btcDominance = {
            ...nextPartials.btcDominance,
            failed: false,
            value: Number.isFinite(btc) ? btc : null,
            sourceUrl: CG_URL,
            observedAt: collectedAt,
            sourceAsOf: collectedAt,
        };
        nextPartials.ethDominance = {
            ...nextPartials.ethDominance,
            failed: false,
            value: Number.isFinite(eth) ? eth : null,
            sourceUrl: CG_URL,
            observedAt: collectedAt,
            sourceAsOf: collectedAt,
        };
        nextPartials.totalMarketCap = {
            ...nextPartials.totalMarketCap,
            failed: false,
            value: Number.isFinite(cap) ? cap : null,
            sourceUrl: CG_URL,
            observedAt: collectedAt,
            sourceAsOf: collectedAt,
        };
        nextPartials.totalVolume = {
            ...nextPartials.totalVolume,
            failed: false,
            value: Number.isFinite(vol) ? vol : null,
            sourceUrl: CG_URL,
            observedAt: collectedAt,
            sourceAsOf: collectedAt,
        };
        if (!Number.isFinite(btc)) nextPartials.btcDominance.failed = true;
        if (!Number.isFinite(eth)) nextPartials.ethDominance.failed = true;
        if (!Number.isFinite(cap)) nextPartials.totalMarketCap.failed = true;
        if (!Number.isFinite(vol)) nextPartials.totalVolume.failed = true;
    } catch (error) {
        errors.push(`coingecko:${error.message || error}`);
        console.warn("[MARKET_DASH] macro CG", error.message || error);
        for (const key of ["btcDominance", "ethDominance", "totalMarketCap", "totalVolume"]) {
            nextPartials[key].reason = "coingecko_fetch_failed";
        }
    }

    try {
        const body = await fetchJson(FNG_URL);
        const row = body?.data?.[0];
        if (row) {
            const v = Number(row.value);
            fearGreedLabel = row.value_classification || fearGreedLabel;
            // alternative.me timestamp is unix seconds of the day bucket when present
            const tsSec = Number(row.timestamp);
            fngSourceAsOf = Number.isFinite(tsSec)
                ? new Date(tsSec * 1000).toISOString()
                : collectedAt;
            fngOk = Number.isFinite(v);
            nextPartials.fearGreed = {
                ...nextPartials.fearGreed,
                failed: !fngOk,
                value: fngOk ? v : null,
                displayValue: fearGreedLabel,
                sourceUrl: FNG_URL,
                observedAt: fngSourceAsOf,
                sourceAsOf: fngSourceAsOf,
                observationDate: fngSourceAsOf ? fngSourceAsOf.slice(0, 10) : null,
            };
        } else {
            nextPartials.fearGreed.reason = "fng_empty";
        }
    } catch (error) {
        errors.push(`fng:${error.message || error}`);
        console.warn("[MARKET_DASH] macro F&G", error.message || error);
        nextPartials.fearGreed.reason = "fng_fetch_failed";
    }

    const metrics = {
        btcDominance: mergeMetricObservation(prevMetrics.btcDominance, nextPartials.btcDominance, attemptAt),
        ethDominance: mergeMetricObservation(prevMetrics.ethDominance, nextPartials.ethDominance, attemptAt),
        totalMarketCap: mergeMetricObservation(prevMetrics.totalMarketCap, nextPartials.totalMarketCap, attemptAt),
        totalVolume: mergeMetricObservation(prevMetrics.totalVolume, nextPartials.totalVolume, attemptAt),
        fearGreed: mergeMetricObservation(prevMetrics.fearGreed, nextPartials.fearGreed, attemptAt),
    };
    if (fearGreedLabel && metrics.fearGreed) {
        metrics.fearGreed.displayValue = fearGreedLabel;
    }

    const legacy = legacyFromMetrics(metrics, { fearGreedLabel });
    const anyFallback =
        (!cgOk && legacy.btcDominance != null) || (!fngOk && legacy.fearGreed != null);

    // Compat updatedAt: max observedAt of successful metrics (không bump khi chỉ fallback)
    const observedTimes = Object.values(metrics)
        .map((m) => (m?.observedAt ? new Date(m.observedAt).getTime() : null))
        .filter((t) => Number.isFinite(t));
    const updatedAt = observedTimes.length
        ? new Date(Math.max(...observedTimes)).toISOString()
        : prev.updatedAt || collectedAt;

    const out = {
        updatedAt,
        collectedAt,
        ...legacy,
        fearGreedLabel,
        stale: anyFallback,
        errors,
        metrics,
        provenanceVersion: 1,
    };

    await saveMacro(out);
    return out;
}

module.exports = { collectMacro };
