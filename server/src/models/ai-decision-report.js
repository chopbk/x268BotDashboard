const mongoose = require("mongoose");

const aiDecisionReportSchema = new mongoose.Schema(
    {
        actorId: { type: String, required: true, index: true },
        scope: { type: String, enum: ["position", "account"], required: true, index: true },
        tradeKey: { type: String, default: null, index: true },
        account: { type: String, default: null, index: true },
        symbol: { type: String, default: null },
        side: { type: String, default: null },
        snapshotId: { type: String, required: true },
        asOf: { type: String, required: true },
        report: { type: mongoose.Schema.Types.Mixed, required: true },
        model: { type: String, default: null },
        promptVersion: { type: String, default: null },
        formulaVersion: { type: String, default: null },
        source: { type: String, enum: ["ai", "rules"], default: "rules" },
        riskLevel: { type: String, default: null, index: true },
    },
    { timestamps: true, collection: "web_ai_decision_reports" }
);

aiDecisionReportSchema.index({ actorId: 1, scope: 1, createdAt: -1 });
aiDecisionReportSchema.index({ actorId: 1, account: 1, scope: 1, createdAt: -1 });

module.exports = mongoose.models.AiDecisionReport
    || mongoose.model("AiDecisionReport", aiDecisionReportSchema);
