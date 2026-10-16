const mongoose = require("mongoose");

const schema = new mongoose.Schema(
    {
        _id: { type: String },
        leaseOwner: { type: String, default: null },
        leaseUntil: { type: Date, default: null },
        status: { type: String, default: "idle" },
        lastRunAt: { type: Date, default: null },
        lastSuccessAt: { type: Date, default: null },
        lastError: { type: String, default: null },
        metrics: { type: mongoose.Schema.Types.Mixed, default: null },
        updatedAt: { type: Date, default: Date.now },
    },
    { collection: "market_collector_state", timestamps: false }
);

module.exports =
    mongoose.models.MarketCollectorState || mongoose.model("MarketCollectorState", schema);
