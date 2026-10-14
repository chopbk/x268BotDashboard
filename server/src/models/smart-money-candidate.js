const mongoose = require("mongoose");

const smartMoneyCandidateSchema = new mongoose.Schema(
    {
        _id: { type: String, required: true },
        version: { type: String, required: true },
        generatedAt: { type: Date, required: true },
        expiresAt: { type: Date, default: null },
        items: { type: [mongoose.Schema.Types.Mixed], default: [] },
    },
    { collection: "smart_money_candidates", timestamps: false }
);

module.exports =
    mongoose.models.SmartMoneyCandidate || mongoose.model("SmartMoneyCandidate", smartMoneyCandidateSchema);
