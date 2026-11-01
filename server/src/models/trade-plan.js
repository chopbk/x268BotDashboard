const mongoose = require("mongoose");

/**
 * Trade plan draft — quant terminal Q1.
 * Collection: web_trade_plans
 */
const TradePlanSchema = new mongoose.Schema(
    {
        actorId: { type: String, required: true, index: true },
        planRevision: { type: Number, required: true, default: 1 },
        state: {
            type: String,
            enum: ["draft", "previewed", "submitted", "expired", "cancelled"],
            default: "draft",
            index: true,
        },
        target: {
            username: String,
            env: String,
            exchange: String,
            marketType: { type: String, default: "usdt_perp_linear" },
            instrumentId: String,
            symbol: String,
            side: String,
            positionSide: String,
            positionIdx: Number,
        },
        thesis: { type: String, default: "", maxlength: 2000 },
        entryType: { type: String, default: "MARKET" },
        entryPrice: String,
        stopLoss: String,
        takeProfits: { type: [String], default: [] },
        quantity: String,
        riskBudget: String,
        timeframe: { type: String, default: "15m" },
        signalEventId: String,
        setupId: String,
        sourceSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
        expiresAt: { type: Date, index: true },
        lastPreviewId: String,
        lastPreviewHash: String,
    },
    {
        versionKey: false,
        timestamps: true,
        collection: "web_trade_plans",
    }
);

TradePlanSchema.index({ actorId: 1, updatedAt: -1 });
TradePlanSchema.index({ actorId: 1, "target.symbol": 1, state: 1 });

module.exports = mongoose.models.TradePlan || mongoose.model("TradePlan", TradePlanSchema);
