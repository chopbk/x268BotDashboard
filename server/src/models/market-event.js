const mongoose = require("mongoose");

const schema = new mongoose.Schema(
    {
        symbol: { type: String, required: true, index: true },
        type: { type: String, required: true, index: true },
        style: { type: String, default: null },
        timeframe: { type: String, default: null },
        formulaVersion: { type: String, required: true },
        payload: { type: mongoose.Schema.Types.Mixed, default: {} },
        createdAt: { type: Date, default: Date.now, index: true },
    },
    { collection: "market_events", timestamps: false }
);

schema.index({ symbol: 1, type: 1, style: 1, timeframe: 1, createdAt: -1 });

module.exports = mongoose.models.MarketEvent || mongoose.model("MarketEvent", schema);
