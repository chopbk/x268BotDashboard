/**
 * Normalize entry reference từ signal_infos.prices / infos (allowlist đã xác minh).
 * Spec: docs/market-position-setup-spec.md §7
 */

const ENTRY_FIELDS = Object.freeze(["entryPrice", "entry", "entries"]);
const STOP_FIELDS = Object.freeze(["slPrice", "stop", "sl", "stopLoss"]);

function num(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function collectNumbers(value) {
    if (value == null) return [];
    if (Array.isArray(value)) {
        return value.map(num).filter((n) => n != null);
    }
    if (typeof value === "object") {
        return Object.values(value).map(num).filter((n) => n != null);
    }
    const n = num(value);
    return n != null ? [n] : [];
}

function pickFromObject(obj, fields) {
    if (!obj || typeof obj !== "object") return { values: [], sourceField: null };
    for (const field of fields) {
        if (!(field in obj)) continue;
        const values = collectNumbers(obj[field]);
        if (values.length) return { values, sourceField: field };
    }
    return { values: [], sourceField: null };
}

/**
 * @returns {{ entryLow, entryHigh, stop, expiresAt, sourceField, referenceKind } | null}
 */
function normalizeEntryReference(row) {
    const prices = row?.prices && typeof row.prices === "object" ? row.prices : null;
    const infos = row?.infos && typeof row.infos === "object" ? row.infos : null;

    let picked = pickFromObject(prices, ENTRY_FIELDS);
    if (!picked.values.length) picked = pickFromObject(infos, ENTRY_FIELDS);
    if (!picked.values.length) return null;

    const sorted = [...picked.values].sort((a, b) => a - b);
    const entryLow = sorted[0];
    const entryHigh = sorted[sorted.length - 1];
    const referenceKind = entryLow === entryHigh ? "point" : "range";

    let stopPick = pickFromObject(prices, STOP_FIELDS);
    if (!stopPick.values.length) stopPick = pickFromObject(infos, STOP_FIELDS);
    const stop = stopPick.values.length ? stopPick.values[0] : null;

    // expiresAt từ bot payload V2 (infos/prices) — không suy từ openTime
    let expiresAt = null;
    const expRaw =
        infos?.expiresAt ??
        prices?.expiresAt ??
        row?.expiresAt ??
        null;
    if (expRaw != null) {
        const t = expRaw instanceof Date ? expRaw.getTime() : Number(expRaw);
        if (Number.isFinite(t) && t > 0) expiresAt = new Date(t).toISOString();
    }

    return {
        entryLow,
        entryHigh,
        stop,
        expiresAt,
        sourceField: picked.sourceField,
        referenceKind,
    };
}

function priceRelation(price, entryRef, atrCurrent = null) {
    if (price == null || !Number.isFinite(Number(price)) || !entryRef) return "unknown";
    const p = Number(price);
    const L = entryRef.entryLow;
    const H = entryRef.entryHigh;
    if (L == null || H == null) return "unknown";
    const tickTol = Math.max(Math.abs(p) * 1e-8, 1e-12);
    if (p >= L - tickTol && p <= H + tickTol) return "in_range";
    const d = p < L ? L - p : p - H;
    if (atrCurrent != null && atrCurrent > 0 && d <= 0.5 * atrCurrent) return "near";
    return p < L ? "below" : "above";
}

function signalValidity(row, entryRef) {
    const status = String(row?.status || "").toUpperCase();
    if (status === "CLOSE") return "source_closed";
    if (!entryRef) return "unknown";
    if (entryRef.expiresAt) {
        const exp = new Date(entryRef.expiresAt).getTime();
        if (Number.isFinite(exp) && Date.now() > exp) return "expired";
    }
    // Thiếu contract lifecycle nguồn → unknown (không tự suy active)
    if (status === "OPEN" && entryRef.entryLow != null) return "unknown";
    return "unknown";
}

function toSignalEntry(row, opts = {}) {
    const entryReference = normalizeEntryReference(row);
    const price = opts.price;
    const atrCurrent = opts.atrCurrent;
    return {
        id: String(row.id || row._id || `${row.signal}-${row.openTime}`),
        source: row.signal || null,
        side: row.side || null,
        openTime: row.openTime || null,
        sourceStatus: row.status || null,
        type: row.type || null,
        entryReference,
        priceRelation: priceRelation(price, entryReference, atrCurrent),
        validity: signalValidity(row, entryReference),
        quality: entryReference ? "ok" : "missing_entry",
        missingEntry: !entryReference,
    };
}

module.exports = {
    ENTRY_FIELDS,
    normalizeEntryReference,
    priceRelation,
    signalValidity,
    toSignalEntry,
};
