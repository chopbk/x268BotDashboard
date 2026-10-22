/**
 * Filter / sort / limit cho view=location.
 */
const { ANALYSIS_TFS, locationSummary, priceFreshness } = require("./location");
const { enrichSetupEntryState, pickPrimarySetup } = require("./setup-engine");
const { pickNearestZones } = require("./zone-engine");
const { toSignalEntry } = require("./signal-entry");

const SCREENS = Object.freeze([
    "all",
    "near_support",
    "near_resistance",
    "buy_zone",
    "sell_zone",
    "entry_long",
    "entry_short",
    "retest",
    "flow_aligned",
]);

const TOP_ALLOWED = Object.freeze([10, 25, 50]);

function normalizeTop(raw, fallback = 10) {
    const n = Number.parseInt(raw, 10);
    if (n === 20) return 25;
    if (n === 30) return 50;
    if (TOP_ALLOWED.includes(n)) return n;
    return fallback;
}

function normalizeAnalysisTf(raw) {
    return ANALYSIS_TFS.includes(raw) ? raw : "1h";
}

function normalizeScreen(raw) {
    return SCREENS.includes(raw) ? raw : "all";
}

function normalizeEntrySource(raw) {
    return raw === "signal" ? "signal" : "technical";
}

function nullLast(a, b, dir = 1) {
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    return (a - b) * dir;
}

function reenrichLocation(loc, price, priceAsOf, now = Date.now()) {
    if (!loc) return null;
    const fresh = priceFreshness(priceAsOf, now);
    const atr = loc.atrCurrent;
    const lastIdx = Math.max(0, (loc.zones || []).reduce((m, z) => Math.max(m, z.confirmedIndex || 0), 0));
    const picked = pickNearestZones(loc.zones || [], price, atr, lastIdx);
    const setups = (loc.setups || []).map((s) => enrichSetupEntryState(s, price, fresh));
    return {
        ...loc,
        price,
        priceAsOf,
        priceFresh: fresh,
        support: picked.support,
        resistance: picked.resistance,
        positionTags: fresh ? picked.positionTags : ["unknown"],
        recentEvents: picked.recentEvents,
        setups,
        primarySetup: pickPrimarySetup(setups),
    };
}

function matchScreen(row, screen, entrySource) {
    if (screen === "all") return true;
    const loc = row.location;
    const tags = loc?.positionTags || [];
    const setup = loc?.primarySetup;
    const events = loc?.recentEvents || [];
    if (screen === "near_support") {
        return tags.includes("near_support") || tags.includes("in_support");
    }
    if (screen === "near_resistance") {
        return tags.includes("near_resistance") || tags.includes("in_resistance");
    }
    if (screen === "buy_zone") {
        return (
            entrySource === "technical" &&
            setup?.side === "long" &&
            setup?.lifecycle === "active" &&
            setup?.entryState === "in_entry" &&
            (loc?.quality === "ready" || loc?.quality === "partial")
        );
    }
    if (screen === "sell_zone") {
        return (
            entrySource === "technical" &&
            setup?.side === "short" &&
            setup?.lifecycle === "active" &&
            setup?.entryState === "in_entry" &&
            (loc?.quality === "ready" || loc?.quality === "partial")
        );
    }
    if (screen === "entry_long") {
        if (entrySource === "signal") {
            return (row.signalEntries || []).some(
                (e) =>
                    e.side === "LONG" &&
                    e.priceRelation === "in_range" &&
                    String(e.sourceStatus || "").toUpperCase() !== "CLOSE" &&
                    !e.missingEntry
            );
        }
        return setup?.side === "long" && setup?.lifecycle === "active" && setup?.entryState === "in_entry";
    }
    if (screen === "entry_short") {
        if (entrySource === "signal") {
            return (row.signalEntries || []).some(
                (e) =>
                    e.side === "SHORT" &&
                    e.priceRelation === "in_range" &&
                    String(e.sourceStatus || "").toUpperCase() !== "CLOSE" &&
                    !e.missingEntry
            );
        }
        return setup?.side === "short" && setup?.lifecycle === "active" && setup?.entryState === "in_entry";
    }
    if (screen === "retest") {
        return events.some((e) => e.type === "retest");
    }
    if (screen === "flow_aligned") {
        const flow = row.flow;
        if (!flow || flow.stale || !flow.bias || flow.bias === "unclear" || flow.bias === "both") return false;
        if (!setup || setup.lifecycle !== "active") return false;
        if (flow.bias === "long" && setup.side === "long") return true;
        if (flow.bias === "short" && setup.side === "short") return true;
        return false;
    }
    return true;
}

function defaultRank(row) {
    const loc = row.location || {};
    const setup = loc.primarySetup;
    const tags = loc.positionTags || [];
    const events = loc.recentEvents || [];
    if (setup?.lifecycle === "active" && setup.entryState === "in_entry") return 0;
    if (events.some((e) => e.type === "retest")) return 1;
    if (tags.includes("in_support") || tags.includes("in_resistance")) return 2;
    if (tags.includes("near_support") || tags.includes("near_resistance")) return 3;
    return 4;
}

function sortLocationRows(rows, sortKey, dirKey) {
    const dir = dirKey === "asc" ? 1 : -1;
    rows.sort((a, b) => {
        let cmp = 0;
        if (sortKey === "symbol") {
            cmp = String(a.symbol).localeCompare(String(b.symbol));
        } else if (sortKey === "support") {
            cmp = nullLast(a.location?.support?.distanceAtr, b.location?.support?.distanceAtr, 1);
        } else if (sortKey === "resistance") {
            cmp = nullLast(a.location?.resistance?.distanceAtr, b.location?.resistance?.distanceAtr, 1);
        } else if (sortKey === "entry") {
            const da = a.location?.primarySetup?.entryState === "in_entry" ? 0 : a.location?.support?.distanceAtr;
            const db = b.location?.primarySetup?.entryState === "in_entry" ? 0 : b.location?.support?.distanceAtr;
            cmp = nullLast(da, db, 1);
        } else if (sortKey === "setupAge") {
            cmp = nullLast(
                a.location?.primarySetup?.createdAt
                    ? new Date(a.location.primarySetup.createdAt).getTime()
                    : null,
                b.location?.primarySetup?.createdAt
                    ? new Date(b.location.primarySetup.createdAt).getTime()
                    : null,
                -1
            );
        } else if (sortKey === "volume") {
            cmp = (a.price?.volume24h ?? 0) - (b.price?.volume24h ?? 0);
        } else {
            // default groups
            cmp = defaultRank(a) - defaultRank(b);
            if (cmp === 0) {
                const da =
                    a.location?.support?.distanceAtr ??
                    a.location?.resistance?.distanceAtr ??
                    null;
                const db =
                    b.location?.support?.distanceAtr ??
                    b.location?.resistance?.distanceAtr ??
                    null;
                cmp = nullLast(da, db, 1);
            }
            if (cmp === 0) cmp = (a.volumeRank ?? 999) - (b.volumeRank ?? 999);
            if (cmp === 0) cmp = String(a.symbol).localeCompare(String(b.symbol));
            return cmp;
        }
        if (cmp === 0) cmp = (a.volumeRank ?? 999) - (b.volumeRank ?? 999);
        if (cmp === 0) cmp = String(a.symbol).localeCompare(String(b.symbol));
        return cmp * (sortKey === "default" ? 1 : dir);
    });
    return rows;
}

function buildSignalEntries(pack, price, atrCurrent) {
    const entries = pack?.entries || pack?.recent || [];
    return entries.map((row) => {
        const enriched = toSignalEntry(
            {
                _id: row.id,
                signal: row.signal,
                side: row.side,
                status: row.status,
                type: row.type,
                openTime: row.openTime,
                prices: row.entryReference
                    ? {
                          entryPrice:
                              row.entryReference.referenceKind === "point"
                                  ? row.entryReference.entryLow
                                  : [row.entryReference.entryLow, row.entryReference.entryHigh],
                      }
                    : undefined,
            },
            { price, atrCurrent }
        );
        // Giữ field đã normalize từ pack nếu có
        return {
            ...enriched,
            entryReference: row.entryReference ?? enriched.entryReference,
            missingEntry: row.missingEntry ?? enriched.missingEntry,
            validity: row.validity || enriched.validity,
            priceRelation: price != null ? enriched.priceRelation : row.priceRelation || "unknown",
        };
    });
}

module.exports = {
    SCREENS,
    TOP_ALLOWED,
    normalizeTop,
    normalizeAnalysisTf,
    normalizeScreen,
    normalizeEntrySource,
    reenrichLocation,
    matchScreen,
    sortLocationRows,
    buildSignalEntries,
    locationSummary,
};
