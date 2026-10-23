const mongoose = require("mongoose");

const schema = new mongoose.Schema(
    {
        symbol: { type: String, required: true, index: true },
        ts: { type: Date, required: true },
        rate: { type: Number, required: true },
        markPrice: { type: Number, default: null },
    },
    { collection: "market_dash_funding_hist", timestamps: false }
);

schema.index({ symbol: 1, ts: 1 }, { unique: true });
schema.index({ ts: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports =
    mongoose.models.MarketDashFundingHist || mongoose.model("MarketDashFundingHist", schema);
