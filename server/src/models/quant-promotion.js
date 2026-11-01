const mongoose = require("mongoose");

const QuantPromotionSchema = new mongoose.Schema(
    {
        promotionId: { type: String, required: true, unique: true },
        experimentId: { type: String, required: true, index: true },
        actorId: { type: String, required: true },
        fromStage: { type: String },
        toStage: { type: String, required: true },
        evidence: { type: mongoose.Schema.Types.Mixed },
        proposedConfigDiff: { type: mongoose.Schema.Types.Mixed },
        status: {
            type: String,
            enum: ["proposed", "reviewed", "applied", "rejected"],
            default: "proposed",
        },
        note: { type: String },
        // Invariant: never auto-set PAPER/INVERT
        autoApplied: { type: Boolean, default: false },
    },
    { timestamps: true, collection: "web_quant_promotions" }
);

module.exports = mongoose.models.QuantPromotion
    || mongoose.model("QuantPromotion", QuantPromotionSchema);
