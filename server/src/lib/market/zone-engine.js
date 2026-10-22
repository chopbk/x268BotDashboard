/**
 * Swing zone lifecycle v1 — chỉ nến đóng, không look-ahead.
 * Spec: docs/market-position-setup-spec.md §5
 */
const { findSwings, atr: atrAtEnd } = require("../market-structure");

const ZONE_VERSION = "zone-v1";
const PIVOT_LEFT = 2;
const PIVOT_RIGHT = 2;
const BAND_ATR = 0.15;
const NEAR_ATR = 0.5;
const ZONE_EXPIRY_BARS = 50;
const RECENT_EVENT_BARS = 3;

function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function closeTimeOf(candle) {
    if (!candle) return null;
    return candle.closeTime || candle.openTime || null;
}

function zoneId(symbol, timeframe, role, pivotAtMs, version = ZONE_VERSION) {
    return `${String(symbol).toUpperCase()}|${timeframe}|${role}|${pivotAtMs}|${version}`;
}

/** ATR Wilder tại từng index (null khi chưa đủ). */
function atrSeries(candles, period = 14) {
    const out = new Array(candles.length).fill(null);
    if (!candles || candles.length < period + 1) return out;
    const trs = [];
    for (let i = 1; i < candles.length; i += 1) {
        const cur = candles[i];
        const prev = candles[i - 1];
        trs.push(
            Math.max(
                cur.high - cur.low,
                Math.abs(cur.high - prev.close),
                Math.abs(cur.low - prev.close)
            )
        );
    }
    let value = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    // trs[j] corresponds to candle index j+1
    out[period] = value;
    for (let i = period; i < trs.length; i += 1) {
        value = (value * (period - 1) + trs[i]) / period;
        out[i + 1] = value;
    }
    return out;
}

function bandAround(pivotPrice, atrVal) {
    const p = num(pivotPrice);
    const a = num(atrVal);
    if (p == null || a == null || a <= 0) return null;
    const half = BAND_ATR * a;
    return { low: p - half, high: p + half, atrAtConfirmation: a };
}

function distanceToBand(price, low, high) {
    const p = num(price);
    const L = num(low);
    const H = num(high);
    if (p == null || p <= 0 || L == null || H == null) {
        return { d: null, distancePct: null, distanceAtr: null, relation: "unknown" };
    }
    if (p >= L && p <= H) {
        return { d: 0, distancePct: 0, distanceAtr: 0, relation: "inside" };
    }
    const d = Math.max(L - p, 0, p - H);
    return {
        d,
        distancePct: (100 * d) / p,
        distanceAtr: null, // fill with atr later
        relation: p < L ? "below" : "above",
    };
}

function relationWithAtr(price, low, high, atrCurrent) {
    const base = distanceToBand(price, low, high);
    const a = num(atrCurrent);
    if (base.d == null) return { ...base, distanceAtr: null, nearFar: "unknown" };
    if (base.relation === "inside") {
        return { ...base, distanceAtr: 0, nearFar: "inside" };
    }
    const distanceAtr = a != null && a > 0 ? base.d / a : null;
    let nearFar = "far";
    if (distanceAtr != null && distanceAtr <= NEAR_ATR) nearFar = "near";
    else if (distanceAtr == null) nearFar = "unknown";
    return { ...base, distanceAtr, nearFar };
}

function candleTouchesBand(candle, low, high) {
    if (!candle) return false;
    return num(candle.high) >= low && num(candle.low) <= high;
}

/**
 * Replay zones từ nến đóng. prevState giữ zones terminal qua restart.
 * @returns {{ zones: object[], events: object[], lastProcessedCloseTime: string|null, atrCurrent: number|null }}
 */
function replayZones(candles, opts = {}) {
    const symbol = String(opts.symbol || "").toUpperCase();
    const timeframe = opts.timeframe || "1h";
    const prev = opts.prev || {};
    const zoneMap = new Map();
    for (const z of prev.zones || []) {
        if (z?.id) zoneMap.set(z.id, { ...z });
    }
    const events = [];
    const atrs = atrSeries(candles, 14);
    const atrCurrent = candles.length ? atrAtEnd(candles, 14) : null;

    let startIndex = PIVOT_LEFT + PIVOT_RIGHT;
    if (prev.lastProcessedCloseTime) {
        const t = new Date(prev.lastProcessedCloseTime).getTime();
        if (Number.isFinite(t)) {
            for (let i = 0; i < candles.length; i += 1) {
                const ct = new Date(closeTimeOf(candles[i])).getTime();
                if (ct > t) {
                    startIndex = Math.max(startIndex, i);
                    break;
                }
                if (i === candles.length - 1) startIndex = candles.length; // all processed
            }
        }
    } else {
        // Bootstrap: xử lý từ đầu nhưng không emit “live” — chỉ dựng state
        startIndex = PIVOT_LEFT + PIVOT_RIGHT;
    }

    const bootstrap = !prev.lastProcessedCloseTime;

    for (let i = startIndex; i < candles.length; i += 1) {
        const candle = candles[i];
        const confirmedPivotIndex = i - PIVOT_RIGHT;
        if (confirmedPivotIndex < PIVOT_LEFT) continue;

        // 1) Pivot mới xác nhận tại close của nến phải thứ 2
        const slice = candles.slice(0, i + 1);
        const { highs, lows } = findSwings(slice, PIVOT_LEFT);
        const confTime = closeTimeOf(candle);
        const atrConf = atrs[i];

        for (const piv of lows) {
            if (piv.index !== confirmedPivotIndex) continue;
            if (atrConf == null) continue;
            const band = bandAround(piv.price, atrConf);
            if (!band) continue;
            const pivotAt = closeTimeOf(candles[piv.index]) || piv.time;
            const pivotAtMs = new Date(pivotAt).getTime();
            const id = zoneId(symbol, timeframe, "support", pivotAtMs);
            if (zoneMap.has(id)) continue;
            const expiresIdx = i + ZONE_EXPIRY_BARS;
            zoneMap.set(id, {
                id,
                parentZoneId: null,
                source: "swing_pivot",
                role: "support",
                low: band.low,
                high: band.high,
                pivotPrice: piv.price,
                pivotAt: new Date(pivotAtMs).toISOString(),
                confirmedAt: confTime ? new Date(confTime).toISOString() : null,
                confirmedIndex: i,
                atrAtConfirmation: band.atrAtConfirmation,
                invalidationLevel: band.low - BAND_ATR * band.atrAtConfirmation,
                expiresAtIndex: expiresIdx,
                status: "active",
                brokenAt: null,
                flipped: false,
                version: ZONE_VERSION,
            });
            if (!bootstrap) {
                events.push({ type: "zone_created", zoneId: id, at: confTime, barIndex: i });
            }
        }
        for (const piv of highs) {
            if (piv.index !== confirmedPivotIndex) continue;
            if (atrConf == null) continue;
            const band = bandAround(piv.price, atrConf);
            if (!band) continue;
            const pivotAt = closeTimeOf(candles[piv.index]) || piv.time;
            const pivotAtMs = new Date(pivotAt).getTime();
            const id = zoneId(symbol, timeframe, "resistance", pivotAtMs);
            if (zoneMap.has(id)) continue;
            const expiresIdx = i + ZONE_EXPIRY_BARS;
            zoneMap.set(id, {
                id,
                parentZoneId: null,
                source: "swing_pivot",
                role: "resistance",
                low: band.low,
                high: band.high,
                pivotPrice: piv.price,
                pivotAt: new Date(pivotAtMs).toISOString(),
                confirmedAt: confTime ? new Date(confTime).toISOString() : null,
                confirmedIndex: i,
                atrAtConfirmation: band.atrAtConfirmation,
                invalidationLevel: band.high + BAND_ATR * band.atrAtConfirmation,
                expiresAtIndex: expiresIdx,
                status: "active",
                brokenAt: null,
                flipped: false,
                version: ZONE_VERSION,
            });
            if (!bootstrap) {
                events.push({ type: "zone_created", zoneId: id, at: confTime, barIndex: i });
            }
        }

        // 2) Break / expire active zones
        for (const z of zoneMap.values()) {
            if (z.status !== "active") continue;
            if (i >= z.expiresAtIndex) {
                z.status = "expired";
                z.expiredAt = confTime ? new Date(confTime).toISOString() : null;
                if (!bootstrap) events.push({ type: "zone_expired", zoneId: z.id, at: confTime, barIndex: i });
                continue;
            }
            const buf = BAND_ATR * z.atrAtConfirmation;
            let broken = false;
            if (z.role === "support" || z.role === "flip_support") {
                broken = num(candle.close) < z.low - buf;
            } else if (z.role === "resistance" || z.role === "flip_resistance") {
                broken = num(candle.close) > z.high + buf;
            }
            if (!broken) continue;
            z.status = "broken";
            z.brokenAt = confTime ? new Date(confTime).toISOString() : null;
            z.brokenIndex = i;
            if (!bootstrap) events.push({ type: "zone_broken", zoneId: z.id, at: confTime, barIndex: i });

            // Flip một lần cho zone gốc (không flip từ flip)
            if (!z.flipped && !z.parentZoneId && (z.role === "support" || z.role === "resistance")) {
                z.flipped = true;
                const flipRole = z.role === "support" ? "flip_resistance" : "flip_support";
                const flipId = zoneId(symbol, timeframe, flipRole, new Date(confTime).getTime());
                if (!zoneMap.has(flipId)) {
                    zoneMap.set(flipId, {
                        id: flipId,
                        parentZoneId: z.id,
                        source: "breakout_flip",
                        role: flipRole,
                        low: z.low,
                        high: z.high,
                        pivotPrice: z.pivotPrice,
                        pivotAt: z.pivotAt,
                        confirmedAt: confTime ? new Date(confTime).toISOString() : null,
                        confirmedIndex: i,
                        atrAtConfirmation: z.atrAtConfirmation,
                        invalidationLevel:
                            flipRole === "flip_support"
                                ? z.low - buf
                                : z.high + buf,
                        expiresAtIndex: i + ZONE_EXPIRY_BARS,
                        status: "active",
                        brokenAt: null,
                        flipped: false,
                        version: ZONE_VERSION,
                    });
                    if (!bootstrap) {
                        events.push({ type: "zone_flip", zoneId: flipId, parentZoneId: z.id, at: confTime, barIndex: i });
                    }
                }
            }
        }

        // 3) Retest trên flip zones (nến sau breakout)
        for (const z of zoneMap.values()) {
            if (z.status !== "active") continue;
            if (z.role !== "flip_support" && z.role !== "flip_resistance") continue;
            if (z.confirmedIndex == null || i <= z.confirmedIndex) continue;
            if (!candleTouchesBand(candle, z.low, z.high)) continue;
            const isLong = z.role === "flip_support";
            const closesFavorable = isLong
                ? num(candle.close) > z.high
                : num(candle.close) < z.low;
            if (!closesFavorable) continue;
            if (!bootstrap) {
                events.push({
                    type: "retest",
                    zoneId: z.id,
                    side: isLong ? "long" : "short",
                    at: confTime,
                    barIndex: i,
                });
            }
            z.lastRetestAt = confTime ? new Date(confTime).toISOString() : null;
            z.lastRetestIndex = i;
        }
    }

    const lastProcessedCloseTime =
        candles.length > 0 ? closeTimeOf(candles[candles.length - 1]) : prev.lastProcessedCloseTime || null;

    return {
        zones: [...zoneMap.values()],
        events,
        lastProcessedCloseTime: lastProcessedCloseTime
            ? new Date(lastProcessedCloseTime).toISOString()
            : null,
        atrCurrent,
        version: ZONE_VERSION,
    };
}

/**
 * Chọn support/resistance gần nhất + position tags.
 */
function pickNearestZones(zones, price, atrCurrent, lastBarIndex) {
    const p = num(price);
    const active = (zones || []).filter((z) => z.status === "active");
    const supports = active.filter((z) => z.role === "support" || z.role === "flip_support");
    const resistances = active.filter((z) => z.role === "resistance" || z.role === "flip_resistance");

    function enrich(z) {
        const rel = relationWithAtr(p, z.low, z.high, atrCurrent);
        let pendingBreak = false;
        if (p != null && z.atrAtConfirmation != null) {
            const buf = BAND_ATR * z.atrAtConfirmation;
            if ((z.role === "support" || z.role === "flip_support") && p < z.low - buf) pendingBreak = true;
            if ((z.role === "resistance" || z.role === "flip_resistance") && p > z.high + buf) pendingBreak = true;
        }
        return {
            ...z,
            distancePct: rel.distancePct,
            distanceAtr: rel.distanceAtr,
            relation: rel.nearFar === "inside" ? "inside" : rel.relation,
            nearFar: rel.nearFar,
            pendingBreak,
        };
    }

    function pickSide(list, preferBelow) {
        const candidates = list
            .map(enrich)
            .filter((z) => {
                if (p == null) return true;
                if (z.nearFar === "inside") return true;
                if (preferBelow) return z.high <= p || z.nearFar === "inside";
                return z.low >= p || z.nearFar === "inside";
            });
        // Nếu không còn phía mong đợi (đang xuyên), vẫn giữ pendingBreak zones
        const pool = candidates.length
            ? candidates
            : list.map(enrich).filter((z) => z.pendingBreak);
        pool.sort((a, b) => {
            const da = a.distanceAtr ?? a.distancePct ?? Number.POSITIVE_INFINITY;
            const db = b.distanceAtr ?? b.distancePct ?? Number.POSITIVE_INFINITY;
            if (da !== db) return da - db;
            const ta = new Date(a.confirmedAt || 0).getTime();
            const tb = new Date(b.confirmedAt || 0).getTime();
            if (ta !== tb) return tb - ta;
            return String(a.id).localeCompare(String(b.id));
        });
        return pool[0] || null;
    }

    const support = pickSide(supports, true);
    const resistance = pickSide(resistances, false);

    const positionTags = [];
    const sNear = support && (support.nearFar === "inside" || support.nearFar === "near");
    const rNear = resistance && (resistance.nearFar === "inside" || resistance.nearFar === "near");
    if (support?.nearFar === "inside") positionTags.push("in_support");
    else if (support?.nearFar === "near") positionTags.push("near_support");
    if (resistance?.nearFar === "inside") positionTags.push("in_resistance");
    else if (resistance?.nearFar === "near") positionTags.push("near_resistance");
    if (sNear && rNear) positionTags.push("conflict");
    if (!positionTags.length && p != null) positionTags.push("mid_range");

    const recentEvents = [];
    for (const z of zones || []) {
        if (z.lastRetestIndex != null && lastBarIndex - z.lastRetestIndex <= RECENT_EVENT_BARS) {
            recentEvents.push({
                type: "retest",
                zoneId: z.id,
                at: z.lastRetestAt,
                barsAgo: lastBarIndex - z.lastRetestIndex,
            });
        }
        if (z.brokenIndex != null && lastBarIndex - z.brokenIndex <= RECENT_EVENT_BARS) {
            recentEvents.push({
                type: "breakout",
                zoneId: z.id,
                at: z.brokenAt,
                barsAgo: lastBarIndex - z.brokenIndex,
            });
        }
    }

    return { support, resistance, positionTags, recentEvents };
}

module.exports = {
    ZONE_VERSION,
    PIVOT_LEFT,
    PIVOT_RIGHT,
    BAND_ATR,
    NEAR_ATR,
    ZONE_EXPIRY_BARS,
    zoneId,
    atrSeries,
    bandAround,
    distanceToBand,
    relationWithAtr,
    candleTouchesBand,
    replayZones,
    pickNearestZones,
};
