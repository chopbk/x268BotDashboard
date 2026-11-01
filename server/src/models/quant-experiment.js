const mongoose = require("mongoose");

const QuantExperimentSchema = new mongoose.Schema(
    {
        experimentId: { type: String, required: true, unique: true },
        actorId: { type: String, required: true, index: true },
        hypothesis: { type: String },
        strategyId: { type: String, required: true },
        strategyVersion: { type: String, default: "1" },
        datasetId: { type: String, required: true },
        datasetVersion: { type: String },
        config: { type: mongoose.Schema.Types.Mixed, required: true },
        configHash: { type: String, required: true },
        codeRevision: { type: String },
        engineVersion: { type: String },
        seed: { type: Number, default: 1 },
        stage: {
            type: String,
            enum: ["draft", "validated", "paper", "live_candidate", "live", "paused", "retired"],
            default: "draft",
        },
        immutable: { type: Boolean, default: false },
    },
    { timestamps: true, collection: "web_quant_experiments" }
);

module.exports = mongoose.models.QuantExperiment
    || mongoose.model("QuantExperiment", QuantExperimentSchema);
