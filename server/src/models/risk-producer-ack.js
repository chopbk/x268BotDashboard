const mongoose = require("mongoose");

const RiskProducerAckSchema = new mongoose.Schema(
    {
        producerId: { type: String, required: true },
        account: String,
        env: String,
        policyId: String,
        policyRevision: { type: Number, required: true },
        producerVersion: String,
        acknowledgedAt: { type: Date, default: Date.now },
    },
    { versionKey: false, timestamps: true, collection: "web_risk_producer_acks" }
);

RiskProducerAckSchema.index({ producerId: 1, account: 1, env: 1, policyId: 1 }, { unique: true });

module.exports = mongoose.models.RiskProducerAck
    || mongoose.model("RiskProducerAck", RiskProducerAckSchema);
