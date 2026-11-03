/**
 * Per-metric provenance helpers (P0a).
 */

function nowIso(d = new Date()) {
    return d.toISOString();
}

/**
 * Build / merge a metric observation record.
 * On fallback: keep observedAt / lastSuccessfulFetchAt / value from previous; only bump lastAttemptAt.
 */
function mergeMetricObservation(prev, nextPartial, attemptAt = new Date()) {
    const attemptIso = nowIso(attemptAt);
    const success = nextPartial && nextPartial.value != null && nextPartial.failed !== true;

    if (success) {
        return {
            id: nextPartial.id || prev?.id || null,
            value: nextPartial.value,
            unit: nextPartial.unit ?? prev?.unit ?? null,
            displayValue: nextPartial.displayValue ?? prev?.displayValue ?? null,
            source: nextPartial.source ?? prev?.source ?? null,
            sourceSeriesId: nextPartial.sourceSeriesId ?? prev?.sourceSeriesId ?? null,
            sourceUrl: nextPartial.sourceUrl ?? prev?.sourceUrl ?? null,
            observationDate: nextPartial.observationDate ?? null,
            referencePeriod: nextPartial.referencePeriod ?? prev?.referencePeriod ?? null,
            sourceAsOf: nextPartial.sourceAsOf ?? nextPartial.observationDate ?? null,
            observedAt: nextPartial.observedAt || attemptIso,
            lastSuccessfulFetchAt: attemptIso,
            lastAttemptAt: attemptIso,
            frequency: nextPartial.frequency ?? prev?.frequency ?? null,
            quality: nextPartial.quality || "fresh",
            marketState: nextPartial.marketState ?? prev?.marketState ?? null,
            reason: nextPartial.reason ?? null,
            previousValue: nextPartial.previousValue ?? null,
            previousObservationDate: nextPartial.previousObservationDate ?? null,
            deltaBp: nextPartial.deltaBp ?? null,
            label: nextPartial.label ?? prev?.label ?? null,
        };
    }

    // Failed / missing this attempt — keep last-good ages
    if (prev && prev.value != null) {
        return {
            ...prev,
            lastAttemptAt: attemptIso,
            quality: prev.quality === "missing" ? "missing" : "stale",
            reason: nextPartial?.reason || prev.reason || "fetch_failed_kept_last_good",
        };
    }

    return {
        id: nextPartial?.id || prev?.id || null,
        value: null,
        unit: nextPartial?.unit ?? prev?.unit ?? null,
        displayValue: null,
        source: nextPartial?.source ?? prev?.source ?? null,
        sourceSeriesId: nextPartial?.sourceSeriesId ?? prev?.sourceSeriesId ?? null,
        sourceUrl: nextPartial?.sourceUrl ?? prev?.sourceUrl ?? null,
        observationDate: null,
        referencePeriod: null,
        sourceAsOf: null,
        observedAt: null,
        lastSuccessfulFetchAt: prev?.lastSuccessfulFetchAt || null,
        lastAttemptAt: attemptIso,
        frequency: nextPartial?.frequency ?? prev?.frequency ?? null,
        quality: "missing",
        marketState: null,
        reason: nextPartial?.reason || "missing",
        previousValue: null,
        previousObservationDate: null,
        deltaBp: null,
        label: nextPartial?.label ?? prev?.label ?? null,
    };
}

function metricAgeMs(metric, now = Date.now()) {
    const iso = metric?.observedAt || metric?.sourceAsOf || metric?.lastSuccessfulFetchAt;
    if (!iso) return null;
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return null;
    return now - t;
}

module.exports = {
    nowIso,
    mergeMetricObservation,
    metricAgeMs,
};
