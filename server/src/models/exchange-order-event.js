const mongoose = require("mongoose");

/**
 * Read model cho order history, cập nhật từ user stream / reconcile / command result.
 * Spec: trading-terminal-spec.md mục 11.2
 */
const ExchangeOrderEventSchema = new mongoose.Schema(
    {
        username: { type: String, required: true, index: true },
        kind: { type: String, enum: ["regular", "algo"], required: true },
        symbol: { type: String, required: true },
        orderId: { type: String, required: true },
        clientOrderId: { type: String, sparse: true },
        positionSide: { type: String, enum: ["LONG", "SHORT", "BOTH"], default: "BOTH" },
        side: { type: String, enum: ["BUY", "SELL"] },
        type: String,
        status: { type: String, index: true },
        price: String,
        triggerPrice: String,
        origQty: String,
        executedQty: String,
        avgPrice: String,
        reduceOnly: { type: Boolean, default: false },
        closePosition: { type: Boolean, default: false },
        timeInForce: String,
        workingType: String,
        exchangeCreatedAt: Date,
        exchangeUpdatedAt: { type: Date, index: true },
        lastEventTime: { type: Number, index: true },
        source: { type: String, enum: ["user_stream", "reconcile", "web_command"], default: "reconcile" },
        rawCode: Number,
    },
    {
        versionKey: false,
        timestamps: true,
        collection: "web_exchange_order_events",
    }
);

// Unique constraint: one record per order
ExchangeOrderEventSchema.index({ username: 1, kind: 1, symbol: 1, orderId: 1 }, { unique: true });
// Query by updated time
ExchangeOrderEventSchema.index({ username: 1, exchangeUpdatedAt: -1 });
// Query open orders
ExchangeOrderEventSchema.index({ username: 1, symbol: 1, status: 1, exchangeUpdatedAt: -1 });
// Lookup by clientOrderId
ExchangeOrderEventSchema.index({ clientOrderId: 1 }, { sparse: true });

module.exports = mongoose.model("ExchangeOrderEvent", ExchangeOrderEventSchema);
