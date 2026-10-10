const mongoose = require("mongoose");

/**
 * Fill/trade history tách từ order history.
 * Spec: trading-terminal-spec.md mục 11.3
 */
const ExchangeFillSchema = new mongoose.Schema(
    {
        username: { type: String, required: true, index: true },
        symbol: { type: String, required: true },
        tradeId: { type: String, required: true },
        orderId: String,
        positionSide: { type: String, enum: ["LONG", "SHORT", "BOTH"], default: "BOTH" },
        side: { type: String, enum: ["BUY", "SELL"] },
        price: String,
        qty: String,
        quoteQty: String,
        realizedPnl: String,
        commission: String,
        commissionAsset: String,
        time: { type: Date, index: true },
        source: { type: String, enum: ["user_stream", "reconcile", "web_command"], default: "reconcile" },
    },
    {
        versionKey: false,
        timestamps: true,
        collection: "web_exchange_fills",
    }
);

// Unique constraint: one fill per trade
ExchangeFillSchema.index({ username: 1, symbol: 1, tradeId: 1 }, { unique: true });
// Query by time
ExchangeFillSchema.index({ username: 1, time: -1 });

module.exports = mongoose.model("ExchangeFill", ExchangeFillSchema);
