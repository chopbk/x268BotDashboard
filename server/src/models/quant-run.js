const mongoose = require("mongoose");

const QuantRunSchema = new mongoose.Schema(
    {
        runId: { type: String, required: true, unique: true },
        experimentId: { type: String, required: true, index: true },
        actorId: { type: String, required: true, index: true },
        status: {
            type: String,
            enum: ["queued", "running", "succeeded", "failed", "cancelled"],
            default: "queued",
            index: true,
        },
        leaseOwner: { type: String },
        leaseUntil: { type: Date },
        inputHash: { type: String },
        outputHash: { type: String },
        result: { type: mongoose.Schema.Types.Mixed },
        error: { type: String },
        cancelRequested: { type: Boolean, default: false },
        resourceBudgetMs: { type: Number, default: 60_000 },
    },
    { timestamps: true, collection: "web_quant_runs" }
);

QuantRunSchema.index({ status: 1, leaseUntil: 1 });

module.exports = mongoose.models.QuantRun
    || mongoose.model("QuantRun", QuantRunSchema);
