/**
 * Provenance envelope helpers — quant.provenance.v1
 */

const QUALITIES = new Set(["fresh", "stale", "missing", "partial", "unsupported"]);

const TTL = Object.freeze({
    mark_quote_trading: 3000,
    balance_snapshot: 15000,
    position_book: 5000,
    market_candle: 60_000,
});

function nowMs() {
    return Date.now();
}

function envelope(partial = {}) {
    const quality = QUALITIES.has(partial.quality) ? partial.quality : "partial";
    return {
        schemaVersion: 1,
        source: partial.source || "unknown",
        sourceAt: partial.sourceAt ?? null,
        receivedAt: partial.receivedAt ?? nowMs(),
        computedAt: partial.computedAt ?? nowMs(),
        snapshotId: partial.snapshotId ?? null,
        quality,
        missingFields: Array.isArray(partial.missingFields) ? partial.missingFields : [],
        coverage: partial.coverage ?? null,
        expiresAt: partial.expiresAt ?? null,
    };
}

function quoteQuality(receivedAt, ttlMs = TTL.mark_quote_trading, at = nowMs()) {
    if (receivedAt == null) return "missing";
    if (at - Number(receivedAt) > ttlMs) return "stale";
    return "fresh";
}

function hashPayload(parts) {
    const crypto = require("crypto");
    const raw = JSON.stringify(parts);
    return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

module.exports = {
    TTL,
    envelope,
    quoteQuality,
    hashPayload,
    nowMs,
};
