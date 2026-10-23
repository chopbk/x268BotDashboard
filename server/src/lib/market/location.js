/**
 * Xây locationByTimeframe: zones + setups + summary vị trí.
 */
const { INTERVAL_MS } = require("./config");
const { replayZones, pickNearestZones, ZONE_VERSION } = require("./zone-engine");
const {
    replaySetups,
    enrichSetupEntryState,
    pickPrimarySetup,
    SETUP_VERSION,
} = require("./setup-engine");

const ANALYSIS_TFS = Object.freeze(["15m", "1h", "4h", "1d"]);
const HTF_MAP = Object.freeze({
    "15m": "1h",
    "1h": "4h",
    "4h": "1d",
    "1d": null,
});

const STRUCTURE_LABEL = Object.freeze({
    bullish: "Tăng",
    bearish: "Giảm",
    contracting: "Co hẹp",
    expanding: "Mở rộng",
    mixed: "Hỗn hợp",
    unknown: "Chưa rõ",
});

function htfOf(tf) {
    return HTF_MAP[tf] || null;
}

function priceFreshness(priceAsOf, now = Date.now()) {
    if (!priceAsOf) return false;
    const t = new Date(priceAsOf).getTime();
    if (!Number.isFinite(t)) return false;
    return now - t <= 60_000;
}

/**
 * @param {Array} closedCandles
 * @param {{ symbol, timeframe, structureBias, htfBias, prev, price, priceAsOf, priceSource, now }} opts
 */
function buildLocationForTf(closedCandles, opts = {}) {
    const symbol = String(opts.symbol || "").toUpperCase();
    const timeframe = opts.timeframe || "1h";
    const prev = opts.prev || {};
    const now = opts.now || Date.now();

    if (!closedCandles?.length) {
        return {
            timeframe,
            quality: "warming",
            zoneVersion: ZONE_VERSION,
            setupVersion: SETUP_VERSION,
            zones: prev.zones || [],
            setups: prev.setups || [],
            lastProcessedCloseTime: prev.lastProcessedCloseTime || null,
            structureBias: opts.structureBias || "unknown",
            structureLabel: STRUCTURE_LABEL[opts.structureBias] || STRUCTURE_LABEL.unknown,
            htfBias: opts.htfBias == null ? "n/a" : opts.htfBias,
            support: null,
            resistance: null,
            positionTags: ["unknown"],
            recentEvents: [],
            primarySetup: null,
            candleCloseTime: null,
            calculatedAt: new Date(now).toISOString(),
            price: opts.price ?? null,
            priceAsOf: opts.priceAsOf || null,
            priceSource: opts.priceSource || null,
        };
    }

    const zoneState = replayZones(closedCandles, {
        symbol,
        timeframe,
        prev: {
            zones: prev.zones || [],
            lastProcessedCloseTime: prev.lastProcessedCloseTime || null,
        },
    });

    const setupState = replaySetups(closedCandles, zoneState.zones, {
        structureBias: opts.structureBias || "unknown",
        htfBias: opts.htfBias == null ? "n/a" : opts.htfBias,
        prev: {
            setups: prev.setups || [],
            lastProcessedCloseTime: prev.setupLastProcessedCloseTime || prev.lastProcessedCloseTime || null,
        },
    });

    const last = closedCandles[closedCandles.length - 1];
    const candleCloseTime = last.closeTime || last.openTime || null;
    const price = opts.price ?? last.close;
    const priceAsOf = opts.priceAsOf || null;
    const fresh = priceFreshness(priceAsOf, now);

    const picked = pickNearestZones(zoneState.zones, price, zoneState.atrCurrent, closedCandles.length - 1);

    const setupsLive = (setupState.setups || []).map((s) => enrichSetupEntryState(s, price, fresh));
    const primarySetup = pickPrimarySetup(setupsLive);

    const confirmations = [];
    if (opts.structureBias && opts.structureBias !== "unknown") {
        confirmations.push({ id: "structure", label: STRUCTURE_LABEL[opts.structureBias] || opts.structureBias });
    }
    if (opts.htfBias && opts.htfBias !== "n/a" && opts.htfBias !== "unknown") {
        confirmations.push({ id: "htf", label: `Khung lớn: ${STRUCTURE_LABEL[opts.htfBias] || opts.htfBias}` });
    }

    let quality = "ready";
    if (closedCandles.length < 40 || zoneState.atrCurrent == null) quality = "warming";

    return {
        timeframe,
        quality,
        zoneVersion: ZONE_VERSION,
        setupVersion: SETUP_VERSION,
        zones: zoneState.zones,
        setups: setupsLive,
        lastProcessedCloseTime: zoneState.lastProcessedCloseTime,
        setupLastProcessedCloseTime: setupState.lastProcessedCloseTime,
        structureBias: opts.structureBias || "unknown",
        structureLabel: STRUCTURE_LABEL[opts.structureBias] || STRUCTURE_LABEL.unknown,
        htfBias: opts.htfBias == null ? "n/a" : opts.htfBias,
        htfLabel:
            opts.htfBias == null || opts.htfBias === "n/a"
                ? "N/A"
                : STRUCTURE_LABEL[opts.htfBias] || opts.htfBias,
        support: picked.support,
        resistance: picked.resistance,
        positionTags: fresh ? picked.positionTags : ["unknown"],
        recentEvents: picked.recentEvents,
        primarySetup,
        atrCurrent: zoneState.atrCurrent,
        candleCloseTime: candleCloseTime ? new Date(candleCloseTime).toISOString() : null,
        calculatedAt: new Date(now).toISOString(),
        price,
        priceAsOf,
        priceSource: opts.priceSource || null,
        priceFresh: fresh,
        confirmations: confirmations.slice(0, 3),
        intervalMs: INTERVAL_MS[timeframe] || null,
    };
}

function locationSummary(loc) {
    if (!loc) return null;
    return {
        timeframe: loc.timeframe,
        quality: loc.quality,
        structureBias: loc.structureBias,
        structureLabel: loc.structureLabel,
        htfBias: loc.htfBias,
        htfLabel: loc.htfLabel,
        support: loc.support
            ? {
                  id: loc.support.id,
                  low: loc.support.low,
                  high: loc.support.high,
                  distancePct: loc.support.distancePct,
                  distanceAtr: loc.support.distanceAtr,
                  nearFar: loc.support.nearFar,
                  role: loc.support.role,
                  source: loc.support.source,
              }
            : null,
        resistance: loc.resistance
            ? {
                  id: loc.resistance.id,
                  low: loc.resistance.low,
                  high: loc.resistance.high,
                  distancePct: loc.resistance.distancePct,
                  distanceAtr: loc.resistance.distanceAtr,
                  nearFar: loc.resistance.nearFar,
                  role: loc.resistance.role,
                  source: loc.resistance.source,
              }
            : null,
        positionTags: loc.positionTags || [],
        recentEvents: loc.recentEvents || [],
        primarySetup: loc.primarySetup
            ? {
                  id: loc.primarySetup.id,
                  side: loc.primarySetup.side,
                  type: loc.primarySetup.type,
                  lifecycle: loc.primarySetup.lifecycle,
                  entryState: loc.primarySetup.entryState,
                  entryLow: loc.primarySetup.entryLow,
                  entryHigh: loc.primarySetup.entryHigh,
                  createdAt: loc.primarySetup.createdAt,
                  createdIndex: loc.primarySetup.createdIndex ?? null,
                  reasons: loc.primarySetup.reasons,
                  invalidationLevel: loc.primarySetup.invalidationLevel ?? null,
                  touchEvidence: loc.primarySetup.touchEvidence ?? null,
                  expiresAtIndex: loc.primarySetup.expiresAtIndex ?? null,
                  firstTouchedAt: loc.primarySetup.firstTouchedAt ?? null,
                  invalidatedAt: loc.primarySetup.invalidatedAt ?? null,
                  invalidationReason: loc.primarySetup.invalidationReason ?? null,
              }
            : null,
        confirmations: loc.confirmations || [],
        price: loc.price,
        priceAsOf: loc.priceAsOf,
        priceSource: loc.priceSource,
        priceFresh: loc.priceFresh,
        candleCloseTime: loc.candleCloseTime,
        calculatedAt: loc.calculatedAt,
        zoneVersion: loc.zoneVersion,
        setupVersion: loc.setupVersion,
    };
}

module.exports = {
    ANALYSIS_TFS,
    HTF_MAP,
    STRUCTURE_LABEL,
    htfOf,
    priceFreshness,
    buildLocationForTf,
    locationSummary,
};
