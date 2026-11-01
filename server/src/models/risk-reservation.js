const mongoose = require("mongoose");

const RiskReservationSchema = new mongoose.Schema(
    {
        reservationId: { type: String, required: true, unique: true },
        account: { type: String, required: true, index: true },
        env: String,
        producer: { type: String, required: true },
        producerVersion: String,
        action: String,
        symbol: String,
        side: String,
        positionSide: String,
        notionalNeed: Number,
        riskNeed: Number,
        quantity: String,
        policyId: String,
        policyRevision: Number,
        policyMode: { type: String, enum: ["observe", "enforce"] },
        requestId: String,
        clientOrderId: String,
        payloadHash: { type: String, required: true },
        idempotencyKey: { type: String, index: true },
        status: {
            type: String,
            enum: ["reserved", "submitted", "filled", "partial", "released", "unknown", "rejected", "observed"],
            default: "reserved",
            index: true,
        },
        exchangeOrderId: String,
        leaseUntil: { type: Date, required: true, index: true },
        reason: String,
        book: { type: String, enum: ["live", "paper"], default: "live" },
    },
    { versionKey: false, timestamps: true, collection: "web_risk_reservations" }
);

RiskReservationSchema.index({ account: 1, status: 1, leaseUntil: 1 });
RiskReservationSchema.index(
    { account: 1, idempotencyKey: 1 },
    { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } }
);

module.exports = mongoose.models.RiskReservation
    || mongoose.model("RiskReservation", RiskReservationSchema);
