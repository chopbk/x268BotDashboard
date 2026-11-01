const mongoose = require("mongoose");

/**
 * Versioned trading preview — không tạo lệnh.
 * Collection: web_trading_previews
 */
const TradingPreviewSchema = new mongoose.Schema(
    {
        previewId: { type: String, required: true, unique: true },
        actorId: { type: String, required: true, index: true },
        planId: String,
        planRevision: Number,
        payloadHash: { type: String, required: true },
        action: { type: String, required: true },
        target: {
            username: String,
            env: String,
            exchange: String,
            marketType: String,
            instrumentId: String,
            symbol: String,
            side: String,
            positionSide: String,
        },
        params: { type: mongoose.Schema.Types.Mixed, default: {} },
        quote: {
            mark: String,
            source: String,
            sourceAt: Number,
            receivedAt: Number,
            expiresAt: Number,
            quality: String,
        },
        sizing: { type: mongoose.Schema.Types.Mixed, default: null },
        risk: { type: mongoose.Schema.Types.Mixed, default: null },
        capability: { type: mongoose.Schema.Types.Mixed, default: null },
        provenance: { type: mongoose.Schema.Types.Mixed, default: null },
        status: {
            type: String,
            enum: ["valid", "expired", "consumed", "invalidated"],
            default: "valid",
            index: true,
        },
        expiresAt: { type: Date, required: true },
    },
    {
        versionKey: false,
        timestamps: true,
        collection: "web_trading_previews",
    }
);

TradingPreviewSchema.index({ actorId: 1, createdAt: -1 });
TradingPreviewSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.TradingPreview
    || mongoose.model("TradingPreview", TradingPreviewSchema);
