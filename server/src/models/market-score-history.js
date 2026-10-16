const mongoose = require("mongoose");

const schema = new mongoose.Schema(
    {
        symbol: { type: String, required: true, index: true },
        calculatedAt: { type: Date, required: true, index: true },
        formulaVersion: { type: String, required: true },
        bucketKey: { type: String, required: true, unique: true },
        snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
        expiresAt: { type: Date, default: null },
    },
    { collection: "market_score_history", timestamps: false }
);

schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
schema.index({ symbol: 1, calculatedAt: -1 });

module.exports = mongoose.models.MarketScoreHistory || mongoose.model("MarketScoreHistory", schema);
