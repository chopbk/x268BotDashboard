/**
 * Setup kỹ thuật v1: bounce vùng + breakout–retest.
 * Spec: docs/market-position-setup-spec.md §6
 */
const { ZONE_VERSION, BAND_ATR, candleTouchesBand } = require("./zone-engine");

const SETUP_VERSION = "setup-v1";
const SETUP_EXPIRY_BARS = 12;

function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function closeTimeOf(candle) {
    return candle?.closeTime || candle?.openTime || null;
}

function setupId(zoneId, side, type, version = SETUP_VERSION) {
    return `${zoneId}|${side}|${type}|${version}`;
}

function structureAllows(side, structureBias, htfBias) {
    const need = side === "long" ? "bullish" : "bearish";
    if (structureBias !== need) return false;
    if (htfBias == null || htfBias === "n/a") return true;
    if (htfBias === "unknown" || htfBias === "warming") return false;
    if (htfBias === "bullish" && side === "short") return false;
    if (htfBias === "bearish" && side === "long") return false;
    return true;
}

/**
 * Replay setups trên zones + nến đóng. Không hồi sinh terminal.
 */
function replaySetups(candles, zones, opts = {}) {
    const prev = opts.prev || {};
    const structureByIndex = opts.structureByIndex || null; // optional: bias at each bar; else use final
    const structureBias = opts.structureBias || "unknown";
    const htfBias = opts.htfBias == null ? "n/a" : opts.htfBias;
    const setupMap = new Map();
    for (const s of prev.setups || []) {
        if (s?.id) setupMap.set(s.id, { ...s });
    }

    let startIndex = 0;
    if (prev.lastProcessedCloseTime) {
        const t = new Date(prev.lastProcessedCloseTime).getTime();
        if (Number.isFinite(t)) {
            startIndex = candles.length;
            for (let i = 0; i < candles.length; i += 1) {
                const ct = new Date(closeTimeOf(candles[i])).getTime();
                if (ct > t) {
                    startIndex = i;
                    break;
                }
            }
        }
    }

    const zoneById = new Map((zones || []).map((z) => [z.id, z]));

    for (let i = startIndex; i < candles.length; i += 1) {
        const candle = candles[i];
        const confTime = closeTimeOf(candle);
        const biasHere = structureByIndex?.[i] || structureBias;

        // Invalidate / expire existing active setups
        for (const s of setupMap.values()) {
            if (s.lifecycle !== "active") continue;
            const z = zoneById.get(s.zoneId);
            if (z && (z.status === "broken" || z.status === "expired")) {
                s.lifecycle = "invalidated";
                s.invalidatedAt = confTime ? new Date(confTime).toISOString() : null;
                s.invalidationReason = `zone_${z.status}`;
                continue;
            }
            if (s.expiresAtIndex != null && i >= s.expiresAtIndex) {
                s.lifecycle = "expired";
                s.expiredAt = confTime ? new Date(confTime).toISOString() : null;
                continue;
            }
            const inv = num(s.invalidationLevel);
            if (inv != null) {
                const hit =
                    s.side === "long"
                        ? num(candle.close) < inv
                        : num(candle.close) > inv;
                if (hit) {
                    s.lifecycle = "invalidated";
                    s.invalidatedAt = confTime ? new Date(confTime).toISOString() : null;
                    s.invalidationReason = "structure_invalidation";
                }
            }
        }

        // Create bounce / retest setups from active zones
        for (const z of zones || []) {
            if (z.status !== "active") continue;
            if (z.confirmedIndex != null && i < z.confirmedIndex) continue;

            let type = null;
            let side = null;
            const open = num(candle.open);
            const close = num(candle.close);
            if (open == null || close == null) continue;

            if (z.role === "support" && candleTouchesBand(candle, z.low, z.high) && close > z.high && close > open) {
                type = "bounce";
                side = "long";
            } else if (
                z.role === "resistance" &&
                candleTouchesBand(candle, z.low, z.high) &&
                close < z.low &&
                close < open
            ) {
                type = "bounce";
                side = "short";
            } else if (
                z.role === "flip_support" &&
                z.lastRetestIndex === i &&
                close > open
            ) {
                type = "breakout_retest";
                side = "long";
            } else if (
                z.role === "flip_resistance" &&
                z.lastRetestIndex === i &&
                close < open
            ) {
                type = "breakout_retest";
                side = "short";
            }

            if (!type || !side) continue;
            if (!structureAllows(side, biasHere, htfBias)) continue;

            const id = setupId(z.id, side, type);
            if (setupMap.has(id)) continue; // không tạo lại / không hồi sinh

            const buf = BAND_ATR * z.atrAtConfirmation;
            setupMap.set(id, {
                id,
                zoneId: z.id,
                side,
                type,
                createdAt: confTime ? new Date(confTime).toISOString() : null,
                createdIndex: i,
                expiresAtIndex: i + SETUP_EXPIRY_BARS,
                entryLow: z.low,
                entryHigh: z.high,
                invalidationLevel: side === "long" ? z.low - buf : z.high + buf,
                lifecycle: "active",
                entryState: "awaiting_entry",
                firstTouchedAt: null,
                touchEvidence: null,
                reasons: [
                    `${type} trên ${z.role}`,
                    `cấu trúc ${biasHere}`,
                    htfBias !== "n/a" ? `htf ${htfBias}` : "htf N/A",
                ],
                invalidatedAt: null,
                version: SETUP_VERSION,
                zoneVersion: z.version || ZONE_VERSION,
            });
        }

        // Update entryState for active setups (closed candle touch after create)
        for (const s of setupMap.values()) {
            if (s.lifecycle !== "active") continue;
            if (s.createdIndex != null && i <= s.createdIndex) continue; // không dùng nến trigger
            const touched = candleTouchesBand(candle, s.entryLow, s.entryHigh);
            if (touched && !s.firstTouchedAt) {
                s.firstTouchedAt = confTime ? new Date(confTime).toISOString() : null;
                s.touchEvidence = "closed_candle";
            }
        }
    }

    const lastProcessedCloseTime =
        candles.length > 0
            ? new Date(closeTimeOf(candles[candles.length - 1])).toISOString()
            : prev.lastProcessedCloseTime || null;

    return {
        setups: [...setupMap.values()],
        lastProcessedCloseTime,
        version: SETUP_VERSION,
    };
}

/**
 * Cập nhật entryState theo giá live (không đổi lifecycle).
 */
function enrichSetupEntryState(setup, price, priceFresh) {
    if (!setup) return setup;
    const out = { ...setup };
    if (out.lifecycle !== "active") {
        out.entryState = out.entryState || "unknown";
        return out;
    }
    if (!priceFresh || price == null || !Number.isFinite(Number(price))) {
        out.entryState = "unknown";
        return out;
    }
    const p = Number(price);
    const inside = p >= out.entryLow && p <= out.entryHigh;
    if (inside) {
        out.entryState = "in_entry";
        if (!out.firstTouchedAt) {
            out.firstTouchedAt = new Date().toISOString();
            out.touchEvidence = "price_observation";
        }
    } else if (out.firstTouchedAt || out.touchEvidence) {
        out.entryState = "left_entry";
    } else {
        out.entryState = "awaiting_entry";
    }
    return out;
}

function pickPrimarySetup(setups, filterSide = null) {
    const active = (setups || []).filter(
        (s) => s.lifecycle === "active" && (!filterSide || s.side === filterSide)
    );
    active.sort((a, b) => {
        const rank = (s) => (s.entryState === "in_entry" ? 2 : s.entryState === "awaiting_entry" ? 1 : 0);
        const r = rank(b) - rank(a);
        if (r !== 0) return r;
        return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });
    return active[0] || null;
}

module.exports = {
    SETUP_VERSION,
    SETUP_EXPIRY_BARS,
    setupId,
    structureAllows,
    replaySetups,
    enrichSetupEntryState,
    pickPrimarySetup,
};
