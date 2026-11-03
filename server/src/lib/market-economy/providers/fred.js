/**
 * FRED daily yields / VIX — CSV graph download or official API when FRED_API_KEY set.
 * Attribution: "This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis."
 * Operator must accept FRED terms; do not wholesale-scrape or strip notices.
 */
const { config } = require("../config");
const { deltaBp } = require("../units");
const { listFredSeriesIds, YIELD_TENORS, getMetric } = require("../registry");

async function fetchText(url, timeoutMs = config.providerTimeoutMs) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            signal: ctrl.signal,
            headers: { accept: "text/csv,application/json,*/*", "user-agent": "web-bot-economy/1.0" },
        });
        const retryAfter = res.headers.get("retry-after");
        if (!res.ok) {
            const err = new Error(`fred ${res.status}`);
            err.status = res.status;
            err.retryAfter = retryAfter;
            throw err;
        }
        return await res.text();
    } finally {
        clearTimeout(t);
    }
}

function parseFredCsv(text, seriesId) {
    const lines = String(text || "")
        .trim()
        .split(/\r?\n/)
        .filter(Boolean);
    if (lines.length < 2) return [];
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const [date, raw] = lines[i].split(",");
        if (!date || raw == null || raw === "." || raw === "") continue;
        const value = Number(raw);
        if (!Number.isFinite(value)) continue;
        rows.push({ observationDate: date.trim(), value, seriesId });
    }
    return rows;
}

function parseFredApiJson(body, seriesId) {
    const obs = body?.observations || [];
    const rows = [];
    for (const o of obs) {
        if (!o?.date || o.value == null || o.value === ".") continue;
        const value = Number(o.value);
        if (!Number.isFinite(value)) continue;
        rows.push({ observationDate: o.date, value, seriesId });
    }
    return rows;
}

async function fetchSeriesObservations(seriesId, { start, end } = {}) {
    const cosd = start || "2024-01-01";
    const coed = end || new Date().toISOString().slice(0, 10);

    if (config.fredApiKey) {
        const url = new URL(config.fredApiBase);
        url.searchParams.set("series_id", seriesId);
        url.searchParams.set("api_key", config.fredApiKey);
        url.searchParams.set("file_type", "json");
        url.searchParams.set("observation_start", cosd);
        url.searchParams.set("observation_end", coed);
        url.searchParams.set("sort_order", "asc");
        const text = await fetchText(url.toString());
        return parseFredApiJson(JSON.parse(text), seriesId);
    }

    const url = `${config.fredCsvBase}?id=${encodeURIComponent(seriesId)}&cosd=${encodeURIComponent(cosd)}&coed=${encodeURIComponent(coed)}`;
    const text = await fetchText(url);
    return parseFredCsv(text, seriesId);
}

function latestWithPrevious(rows) {
    if (!rows?.length) return { latest: null, previous: null };
    const latest = rows[rows.length - 1];
    const previous = rows.length >= 2 ? rows[rows.length - 2] : null;
    return { latest, previous };
}

/**
 * Fetch all registered FRED series with bounded concurrency.
 */
async function fetchAllFredSeries(options = {}) {
    const ids = listFredSeriesIds();
    const concurrency = Math.max(1, config.providerConcurrency);
    const results = {};
    const errors = [];
    let idx = 0;

    async function worker() {
        while (idx < ids.length) {
            const i = idx++;
            const seriesId = ids[i];
            try {
                const rows = await fetchSeriesObservations(seriesId, options);
                results[seriesId] = rows;
            } catch (error) {
                errors.push({ seriesId, message: String(error.message || error), status: error.status, retryAfter: error.retryAfter });
                results[seriesId] = null;
            }
        }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, () => worker()));
    return { results, errors };
}

function buildYieldMetricPayloads(fredBySeries) {
    const out = {};
    for (const y of YIELD_TENORS) {
        const rows = fredBySeries[y.seriesId];
        const { latest, previous } = latestWithPrevious(rows || []);
        const meta = getMetric(y.id);
        if (!latest) {
            out[y.id] = {
                id: y.id,
                failed: true,
                unit: "percent",
                source: "fred",
                sourceSeriesId: y.seriesId,
                frequency: "business_daily",
                label: meta?.label || y.label,
                reason: rows == null ? "fred_fetch_failed" : "fred_empty",
                sourceUrl: `https://fred.stlouisfed.org/series/${y.seriesId}`,
            };
            continue;
        }
        out[y.id] = {
            id: y.id,
            failed: false,
            value: latest.value,
            unit: "percent",
            source: "fred",
            sourceSeriesId: y.seriesId,
            frequency: "business_daily",
            label: meta?.label || y.label,
            observationDate: latest.observationDate,
            sourceAsOf: latest.observationDate,
            observedAt: `${latest.observationDate}T21:00:00.000Z`,
            previousValue: previous?.value ?? null,
            previousObservationDate: previous?.observationDate ?? null,
            deltaBp: deltaBp(latest.value, previous?.value),
            marketState: "closed",
            quality: "fresh",
            sourceUrl: `https://fred.stlouisfed.org/series/${y.seriesId}`,
        };
    }
    return out;
}

function buildVixPayload(fredBySeries) {
    const rows = fredBySeries.VIXCLS;
    const { latest, previous } = latestWithPrevious(rows || []);
    const id = "us.vix.close";
    if (!latest) {
        return {
            id,
            failed: true,
            unit: "index",
            source: "fred",
            sourceSeriesId: "VIXCLS",
            frequency: "business_daily",
            label: "VIX close",
            reason: rows == null ? "fred_fetch_failed" : "fred_empty",
            sourceUrl: "https://fred.stlouisfed.org/series/VIXCLS",
        };
    }
    return {
        id,
        failed: false,
        value: latest.value,
        unit: "index",
        source: "fred",
        sourceSeriesId: "VIXCLS",
        frequency: "business_daily",
        label: "VIX close",
        observationDate: latest.observationDate,
        sourceAsOf: latest.observationDate,
        observedAt: `${latest.observationDate}T21:00:00.000Z`,
        previousValue: previous?.value ?? null,
        previousObservationDate: previous?.observationDate ?? null,
        deltaBp: null,
        marketState: "closed",
        quality: "fresh",
        sourceUrl: "https://fred.stlouisfed.org/series/VIXCLS",
        note: "Daily close; not BTC implied volatility",
    };
}

const FRED_ATTRIBUTION =
    "This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.";

module.exports = {
    fetchSeriesObservations,
    fetchAllFredSeries,
    buildYieldMetricPayloads,
    buildVixPayload,
    parseFredCsv,
    FRED_ATTRIBUTION,
};
