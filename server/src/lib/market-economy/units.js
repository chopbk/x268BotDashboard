/**
 * Yield / spread helpers — basis points and common observation date.
 */

/** deltaBp = (yield_latest - yield_previous) * 100 when yields are percent. */
function deltaBp(latestPercent, previousPercent) {
    if (!Number.isFinite(latestPercent) || !Number.isFinite(previousPercent)) return null;
    return Math.round((latestPercent - previousPercent) * 10000) / 100;
}

/** Spread 10Y−2Y in bp when both yields share the same observation date. */
function spread10y2yBp(yield10yPercent, yield2yPercent) {
    if (!Number.isFinite(yield10yPercent) || !Number.isFinite(yield2yPercent)) return null;
    return Math.round((yield10yPercent - yield2yPercent) * 10000) / 100;
}

/**
 * Pick newest observationDate present on every required tenor.
 * @param {Record<string, { observationDate?: string|null, value?: number|null }>} byMetricId
 * @param {string[]} metricIds
 * @returns {{ observationDate: string|null, values: Record<string, number>|null, gaps: string[] }}
 */
function commonObservationCurve(byMetricId, metricIds) {
    const gaps = [];
    const dateSets = [];
    for (const id of metricIds) {
        const m = byMetricId[id];
        if (!m || m.value == null || !m.observationDate) {
            gaps.push(id);
            continue;
        }
        dateSets.push({ id, date: m.observationDate, value: m.value });
    }
    if (dateSets.length < 2) {
        return { observationDate: null, values: null, gaps: metricIds.filter((id) => !dateSets.find((d) => d.id === id)) };
    }

    const allDates = [...new Set(dateSets.map((d) => d.date))].sort().reverse();
    for (const date of allDates) {
        const values = {};
        let ok = true;
        for (const id of metricIds) {
            const m = byMetricId[id];
            if (!m || m.observationDate !== date || !Number.isFinite(m.value)) {
                ok = false;
                break;
            }
            values[id] = m.value;
        }
        if (ok) return { observationDate: date, values, gaps: [] };
    }

    const missing = metricIds.filter((id) => {
        const m = byMetricId[id];
        return !m || m.value == null || !m.observationDate;
    });
    return { observationDate: null, values: null, gaps: missing.length ? missing : metricIds };
}

function parseDisplayNumber(raw) {
    if (raw == null) return null;
    const s = String(raw).trim();
    if (!s) return null;
    const cleaned = s.replace(/,/g, "").replace(/%/g, "").replace(/K$/i, "e3").replace(/M$/i, "e6").replace(/B$/i, "e9");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
}

module.exports = {
    deltaBp,
    spread10y2yBp,
    commonObservationCurve,
    parseDisplayNumber,
};
