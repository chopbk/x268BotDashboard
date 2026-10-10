const mongoose = require("mongoose");

/**
 * Durable idempotency receipt cho trading mutations.
 * Spec: trading-terminal-spec.md mục 9.2
 * 
 * Bot claim bằng unique insert/findOneAndUpdate atomic trước side effect.
 * Nhận lại cùng key: publish lại receipt/result, không gọi sàn lần hai.
 */
const TradingReceiptSchema = new mongoose.Schema(
    {
        requestId: { type: String, required: true, unique: true },
        idempotencyKey: { type: String, required: true, index: true },
        action: { type: String, required: true, index: true },
        target: {
            username: String,
            env: String,
            symbol: String,
            positionSide: String,
        },
        status: {
            type: String,
            enum: ["claimed", "submitted", "succeeded", "failed", "unknown"],
            default: "claimed",
            index: true,
        },
        exchangeIds: {
            type: [String],
            default: [],
        },
        result: {
            type: mongoose.Schema.Types.Mixed,
            default: null,
        },
        error: {
            type: mongoose.Schema.Types.Mixed,
            default: null,
        },
        actorUserId: String,
        actorUsername: String,
        expiresAt: { type: Date, required: true, index: true },
        claimedAt: { type: Date, default: Date.now },
        submittedAt: Date,
        completedAt: Date,
    },
    {
        versionKey: false,
        timestamps: true,
        collection: "web_trading_receipts",
    }
);

// Unique per actor + idempotencyKey (24h window)
TradingReceiptSchema.index({ actorUserId: 1, idempotencyKey: 1 }, { unique: true });
// Query by target
TradingReceiptSchema.index({ "target.username": 1, "target.symbol": 1 });
// Cleanup old receipts
TradingReceiptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model("TradingReceipt", TradingReceiptSchema);
