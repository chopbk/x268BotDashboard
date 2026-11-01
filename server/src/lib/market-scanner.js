const MarketScanner = require("../models/market-scanner");
const { upsertInboxEvent } = require("./research-inbox");
const { httpError } = require("./http");
const { envelope, nowMs } = require("./provenance");

/** Predicate allowlist — không eval JS/SQL user. */
const ALLOWED_PREDICATES = new Set([
    "price_change_pct",
    "volume_ratio",
    "oi_change_pct",
    "funding_percentile",
    "relative_strength",
    "regime",
    "breakout_state",
    "setup_state",
]);

function actorIdOf(actor) {
    return actor?.id || (actor?._id ? String(actor._id) : "");
}

function publicScanner(doc) {
    if (!doc) return null;
    return {
        id: String(doc._id),
        name: doc.name,
        universe: doc.universe,
        timeframe: doc.timeframe,
        predicates: doc.predicates || [],
        combine: doc.combine || "and",
        cooldownMs: doc.cooldownMs,
        rearm: doc.rearm !== false,
        expiresAt: doc.expiresAt,
        paused: Boolean(doc.paused),
        revision: doc.revision,
        updatedAt: doc.updatedAt,
    };
}

function normalizePredicates(list) {
    if (!Array.isArray(list)) throw httpError(400, "predicates phải là mảng");
    if (list.length > 20) throw httpError(400, "Tối đa 20 predicates");
    return list.map((p) => {
        const op = String(p.op || p.type || "").trim();
        if (!ALLOWED_PREDICATES.has(op)) {
            throw httpError(400, `Predicate không trong allowlist: ${op}`);
        }
        return {
            op,
            cmp: ["gt", "gte", "lt", "lte", "eq"].includes(p.cmp) ? p.cmp : "gt",
            value: p.value,
            field: p.field || null,
        };
    });
}

function cmp(op, left, right) {
    if (left == null || right == null) return null; // unknown — không false
    switch (op) {
        case "gt": return left > right;
        case "gte": return left >= right;
        case "lt": return left < right;
        case "lte": return left <= right;
        case "eq": return left === right;
        default: return null;
    }
}

function readMetric(row, predicate) {
    switch (predicate.op) {
        case "price_change_pct": return Number(row.priceChangePct);
        case "volume_ratio": return Number(row.volumeRatio);
        case "oi_change_pct": return Number(row.oiChangePct);
        case "funding_percentile": return Number(row.fundingPercentile);
        case "relative_strength": return Number(row.rsBtc ?? row.relativeStrength);
        case "regime": return row.regime;
        case "breakout_state": return row.breakoutState;
        case "setup_state": return row.setupState;
        default: return null;
    }
}

/**
 * Evaluate scanner trên snapshot. Missing metric → unknown (không phát tín hiệu ngược).
 * Chỉ confirm breakout khi candleClosed=true.
 */
function evaluateScanner(scanner, rows = [], { candleClosed = true } = {}) {
    const preds = scanner.predicates || [];
    const hits = [];
    const skipped = [];
    for (const row of rows) {
        if (!candleClosed && preds.some((p) => p.op === "breakout_state")) {
            skipped.push({ symbol: row.symbol, reason: "candle_not_closed" });
            continue;
        }
        const results = preds.map((p) => {
            const metric = readMetric(row, p);
            if (metric == null || Number.isNaN(Number(metric)) && typeof metric !== "string") {
                return { unknown: true, op: p.op };
            }
            if (typeof metric === "string") {
                return { ok: cmp("eq", metric, p.value), unknown: false };
            }
            const ok = cmp(p.cmp, Number(metric), Number(p.value));
            if (ok == null) return { unknown: true, op: p.op };
            return { ok, unknown: false };
        });
        if (results.some((r) => r.unknown)) {
            skipped.push({ symbol: row.symbol, reason: "missing_data" });
            continue;
        }
        const pass = scanner.combine === "or"
            ? results.some((r) => r.ok)
            : results.every((r) => r.ok);
        if (pass) hits.push({ symbol: row.symbol, row });
    }
    return {
        hits,
        skipped,
        provenance: envelope({
            source: "market-scanner",
            receivedAt: nowMs(),
            quality: skipped.length && !hits.length ? "partial" : "fresh",
            coverage: { candleClosed, predicateAllowlist: true },
        }),
    };
}

async function createScanner(actor, body = {}) {
    const actorId = actorIdOf(actor);
    const doc = await MarketScanner.create({
        actorId,
        name: String(body.name || "Scanner").slice(0, 80),
        universe: body.universe || "market_top",
        timeframe: body.timeframe || "15m",
        predicates: normalizePredicates(body.predicates || []),
        combine: body.combine === "or" ? "or" : "and",
        cooldownMs: Number(body.cooldownMs) > 0 ? Number(body.cooldownMs) : 300000,
        rearm: body.rearm !== false,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
        paused: false,
    });
    return publicScanner(doc);
}

async function listScanners(actor) {
    const rows = await MarketScanner.find({ actorId: actorIdOf(actor) }).sort({ updatedAt: -1 }).limit(50).lean();
    return { scanners: rows.map(publicScanner) };
}

async function patchScanner(actor, id, body = {}) {
    const doc = await MarketScanner.findById(String(id || ""));
    if (!doc || doc.actorId !== actorIdOf(actor)) throw httpError(404, "Không tìm thấy scanner");
    if (body.name != null) doc.name = String(body.name).slice(0, 80);
    if (body.predicates) doc.predicates = normalizePredicates(body.predicates);
    if (body.paused != null) doc.paused = Boolean(body.paused);
    if (body.combine) doc.combine = body.combine === "or" ? "or" : "and";
    doc.revision += 1;
    await doc.save();
    return publicScanner(doc);
}

/**
 * Chạy scanner + upsert Inbox dedupe theo transition key.
 */
async function runScannerAlert(actor, scannerId, rows, opts = {}) {
    const doc = await MarketScanner.findById(String(scannerId || ""));
    if (!doc || doc.actorId !== actorIdOf(actor)) throw httpError(404, "Không tìm thấy scanner");
    if (doc.paused) return { skipped: true, reason: "paused" };
    if (doc.expiresAt && doc.expiresAt.getTime() <= Date.now()) {
        return { skipped: true, reason: "expired" };
    }
    const result = evaluateScanner(publicScanner(doc), rows, opts);
    const inboxResults = [];
    for (const hit of result.hits) {
        const sourceEventId = `scanner:${doc._id}:${hit.symbol}:${opts.transitionKey || "hit"}`;
        inboxResults.push(await upsertInboxEvent({
            ownerUserId: actorIdOf(actor),
            source: "market_scanner",
            sourceEventId,
            kind: "scanner_hit",
            title: `${doc.name}: ${hit.symbol}`,
            resourceType: "market_scanner",
            resourceId: String(doc._id),
            evidence: { symbol: hit.symbol, notFill: true },
        }));
    }
    return { ...result, inboxResults };
}

module.exports = {
    ALLOWED_PREDICATES,
    createScanner,
    listScanners,
    patchScanner,
    evaluateScanner,
    runScannerAlert,
    publicScanner,
};
