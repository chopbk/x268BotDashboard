const mongoose = require("mongoose");

const schema = new mongoose.Schema(
    {
        symbol: { type: String, required: true, unique: true },
        calculatedAt: { type: Date, required: true, index: true },
        formulaVersion: { type: String, required: true },
        schemaVersion: { type: String, required: true },
        universeVersion: { type: Number, default: null },
        qualityOverall: { type: String, default: null },
        snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
        updatedAt: { type: Date, default: Date.now },
    },
    { collection: "market_score_latest", timestamps: false }
);

schema.index({ updatedAt: -1 });

module.exports = mongoose.models.MarketScoreLatest || mongoose.model("MarketScoreLatest", schema);
