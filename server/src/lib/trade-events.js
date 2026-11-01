const crypto = require("crypto");
const TradeEvent = require("../models/trade-event");
const { envelope, nowMs } = require("./provenance");
const { httpError } = require("./http");

const REASON_CODES = new Set([
    "parse_invalid",
    "duplicate",
    "expired",
    "account_disabled",
    "symbol_blocked",
    "existing_position",
    "risk_rejected",
    "stale_data",
    "exchange_rejected",
    "unknown",
    "legacy_unresolved",
]);

function publicEvent(doc) {
    if (!doc) return null;
    return {
        id: String(doc._id),
        source: doc.source,
        sourceEventId: doc.sourceEventId,
        type: doc.type,
        reasonCode: doc.reasonCode || null,
        message: doc.message || null,
        account: doc.account,
        env: doc.env || null,
        exchange: doc.exchange || null,
        instrumentId: doc.instrumentId || doc.symbol,
        symbol: doc.symbol,
        side: doc.side,
        tradeInstanceId: doc.tradeInstanceId || null,
        signalEventId: doc.signalEventId || null,
        planId: doc.planId || null,
        requestId: doc.requestId || null,
        clientOrderId: doc.clientOrderId || null,
        orderId: doc.orderId || null,
        fillId: doc.fillId || null,
        producer: doc.producer || null,
        sourceAt: doc.sourceAt,
        receivedAt: doc.receivedAt,
        detectedAt: doc.detectedAt,
        clockUncertainty: Boolean(doc.clockUncertainty),
        evidence: doc.evidence,
        provenance: doc.provenance,
        createdAt: doc.createdAt,
    };
}

async function appendTradeEvent(input = {}) {
    const source = String(input.source || "web").slice(0, 64);
    const sourceEventId = String(input.sourceEventId || crypto.randomUUID()).slice(0, 120);
    const type = String(input.type || "unknown");
    const reasonCode = input.reasonCode && REASON_CODES.has(input.reasonCode)
        ? input.reasonCode
        : (input.reasonCode ? "unknown" : undefined);

    const receivedAt = input.receivedAt ?? nowMs();
    const sourceAt = input.sourceAt ?? receivedAt;
    let clockUncertainty = Boolean(input.clockUncertainty);
    if (typeof input.latencyMs === "number" && input.latencyMs < 0) {
        clockUncertainty = true;
    }

    try {
        const doc = await TradeEvent.create({
            source,
            sourceEventId,
            type,
            reasonCode,
            message: input.message ? String(input.message).slice(0, 500) : undefined,
            actorId: input.actorId,
            account: input.account,
            env: input.env,
            exchange: input.exchange,
            instrumentId: input.instrumentId || input.symbol,
            symbol: input.symbol ? String(input.symbol).toUpperCase() : undefined,
            side: input.side,
            tradeInstanceId: input.tradeInstanceId || undefined,
            signalEventId: input.signalEventId || input.eventId || undefined,
            planId: input.planId,
            requestId: input.requestId,
            clientOrderId: input.clientOrderId,
            orderId: input.orderId,
            fillId: input.fillId,
            producer: input.producer,
            producerVersion: input.producerVersion,
            sourceAt,
            receivedAt,
            detectedAt: input.detectedAt ?? nowMs(),
            clockUncertainty,
            evidence: input.evidence || null,
            provenance: input.provenance || envelope({
                source: "trade-events",
                sourceAt,
                receivedAt,
                quality: "fresh",
            }),
        });
        return { created: true, event: publicEvent(doc) };
    } catch (error) {
        if (error?.code === 11000) {
            const existing = await TradeEvent.findOne({ source, sourceEventId }).lean();
            return { created: false, duplicate: true, event: publicEvent(existing) };
        }
        throw error;
    }
}

async function listTimeline(query = {}) {
    const filter = {};
    if (query.tradeInstanceId) filter.tradeInstanceId = String(query.tradeInstanceId);
    if (query.account) filter.account = String(query.account);
    if (query.signalEventId) filter.signalEventId = String(query.signalEventId);
    if (query.requestId) filter.requestId = String(query.requestId);
    if (query.symbol) filter.symbol = String(query.symbol).toUpperCase();
    if (!Object.keys(filter).length) throw httpError(400, "Cần tradeInstanceId|account|signalEventId|requestId");

    const rows = await TradeEvent.find(filter).sort({ sourceAt: 1, createdAt: 1 }).limit(200).lean();
    const unresolved = rows.filter((r) => !r.tradeInstanceId).map(() => "legacy_unresolved");
    return {
        events: rows.map(publicEvent),
        quality: unresolved.length ? "partial" : "fresh",
        missingIdentity: unresolved.length ? ["tradeInstanceId"] : [],
    };
}

function arrivalSlippageBps({ side, fillVwap, reference }) {
    const fill = Number(fillVwap);
    const ref = Number(reference);
    if (!(fill > 0) || !(ref > 0)) return { bps: null, quality: "missing" };
    const sideSign = String(side).toUpperCase() === "SELL" || String(side).toUpperCase() === "SHORT" ? -1 : 1;
    const bps = sideSign * ((fill - ref) / ref) * 10000;
    return { bps, quality: "fresh", referenceKind: "provided" };
}

module.exports = {
    appendTradeEvent,
    listTimeline,
    publicEvent,
    arrivalSlippageBps,
    REASON_CODES,
};
