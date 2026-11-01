const mongoose = require("mongoose");

const RiskPolicySchema = new mongoose.Schema(
    {
        policyId: { type: String, required: true, unique: true },
        revision: { type: Number, required: true, default: 1 },
        scope: {
            type: { type: String, enum: ["account", "actor", "system"], default: "account" },
            username: String,
            actorId: String,
        },
        enabled: { type: Boolean, default: true },
        mode: { type: String, enum: ["observe", "enforce"], default: "observe" },
        effectiveAt: { type: Date, default: Date.now },
        limits: {
            maxGrossNotional: Number,
            maxNetNotional: Number,
            maxSymbolNotional: Number,
            maxRiskAtStop: Number,
            maxOpenPositions: Number,
            maxDailyLoss: Number,
            maxDrawdownPct: Number,
            pauseNewEntries: { type: Boolean, default: false },
        },
        equityBasis: { type: String, default: "wallet_equity_usdt" },
        valuationCurrency: { type: String, default: "USDT" },
        updatedBy: String,
    },
    { versionKey: false, timestamps: true, collection: "web_risk_policies" }
);

RiskPolicySchema.index({ "scope.username": 1, enabled: 1 });

module.exports = mongoose.models.RiskPolicy || mongoose.model("RiskPolicy", RiskPolicySchema);
