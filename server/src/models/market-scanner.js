const mongoose = require("mongoose");

const MarketScannerSchema = new mongoose.Schema(
    {
        actorId: { type: String, required: true, index: true },
        name: { type: String, required: true, maxlength: 80 },
        universe: { type: String, default: "market_top" },
        timeframe: { type: String, default: "15m" },
        predicates: { type: [mongoose.Schema.Types.Mixed], default: [] },
        combine: { type: String, enum: ["and", "or"], default: "and" },
        cooldownMs: { type: Number, default: 300000 },
        rearm: { type: Boolean, default: true },
        expiresAt: Date,
        paused: { type: Boolean, default: false },
        revision: { type: Number, default: 1 },
    },
    { versionKey: false, timestamps: true, collection: "web_market_scanners" }
);

MarketScannerSchema.index({ actorId: 1, updatedAt: -1 });

module.exports = mongoose.models.MarketScanner
    || mongoose.model("MarketScanner", MarketScannerSchema);
