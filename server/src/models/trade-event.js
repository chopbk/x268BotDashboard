const mongoose = require("mongoose");

/**
 * Timeline events append-only — Q4 foundation (P3).
 * Collection: web_trade_events
 */
const TradeEventSchema = new mongoose.Schema(
    {
        source: { type: String, required: true },
        sourceEventId: { type: String, required: true },
        schemaVersion: { type: Number, default: 1 },
        type: { type: String, required: true, index: true },
        reasonCode: String,
        message: String,
        actorId: String,
        account: { type: String, index: true },
        env: String,
        exchange: String,
        instrumentId: String,
        symbol: String,
        side: String,
        tradeInstanceId: { type: String, index: true },
        signalEventId: String,
        planId: String,
        requestId: String,
        clientOrderId: String,
        orderId: String,
        fillId: String,
        producer: String,
        producerVersion: String,
        sourceAt: Number,
        receivedAt: Number,
        detectedAt: Number,
        clockUncertainty: { type: Boolean, default: false },
        evidence: { type: mongoose.Schema.Types.Mixed, default: null },
        provenance: { type: mongoose.Schema.Types.Mixed, default: null },
    },
    { versionKey: false, timestamps: true, collection: "web_trade_events" }
);

TradeEventSchema.index({ source: 1, sourceEventId: 1 }, { unique: true });
TradeEventSchema.index({ account: 1, tradeInstanceId: 1, createdAt: 1 });
TradeEventSchema.index({ signalEventId: 1, createdAt: 1 });

module.exports = mongoose.models.TradeEvent || mongoose.model("TradeEvent", TradeEventSchema);
