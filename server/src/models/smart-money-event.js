const mongoose = require("mongoose");

const smartMoneyEventSchema = new mongoose.Schema(
    {
        symbol: { type: String, required: true, index: true },
        type: { type: String, required: true },
        direction: { type: String, default: null },
        dedupeKey: { type: String, required: true, unique: true },
        at: { type: Date, required: true, index: true },
        window: { type: String, default: null },
        before: { type: mongoose.Schema.Types.Mixed, default: null },
        after: { type: mongoose.Schema.Types.Mixed, default: null },
        zScore: { type: Number, default: null },
        threshold: { type: Number, default: null },
        sampleSize: { type: Number, default: null },
        quality: { type: String, default: null },
        smallSample: { type: Boolean, default: false },
        message: { type: String, default: null },
        expiresAt: { type: Date, default: null },
    },
    { collection: "smart_money_events", timestamps: false }
);

smartMoneyEventSchema.index({ symbol: 1, at: -1 });
smartMoneyEventSchema.index({ at: -1 });

module.exports = mongoose.models.SmartMoneyEvent || mongoose.model("SmartMoneyEvent", smartMoneyEventSchema);
