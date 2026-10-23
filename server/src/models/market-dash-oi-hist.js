const mongoose = require("mongoose");

const schema = new mongoose.Schema(
    {
        symbol: { type: String, required: true, index: true },
        ts: { type: Date, required: true },
        qty: { type: Number, default: null },
        notional: { type: Number, default: null },
        period: { type: String, default: "5m" },
    },
    { collection: "market_dash_oi_hist", timestamps: false }
);

schema.index({ symbol: 1, ts: 1, period: 1 }, { unique: true });
schema.index({ ts: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports = mongoose.models.MarketDashOiHist || mongoose.model("MarketDashOiHist", schema);
