const mongoose = require("mongoose");

const smartMoneyWatchlistSchema = new mongoose.Schema(
    {
        userId: { type: String, required: true, unique: true },
        symbols: { type: [String], default: [] },
        updatedAt: { type: Date, default: Date.now },
    },
    { collection: "smart_money_watchlists", timestamps: false }
);

module.exports =
    mongoose.models.SmartMoneyWatchlist || mongoose.model("SmartMoneyWatchlist", smartMoneyWatchlistSchema);
