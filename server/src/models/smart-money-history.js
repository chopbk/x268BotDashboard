const mongoose = require("mongoose");

const smartMoneyHistorySchema = new mongoose.Schema(
    {
        symbol: { type: String, required: true, index: true },
        collectedAt: { type: Date, required: true },
        bucketKey: { type: String, required: true, unique: true },
        schemaVersion: { type: String, required: true },
        cohortId: { type: String, default: null },
        signalDay: { type: Number, default: null },
        qualityOverall: { type: String, default: null },
        snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
        _expireAt: { type: Date, default: null, index: true },
    },
    { collection: "smart_money_history", timestamps: false }
);

smartMoneyHistorySchema.index({ symbol: 1, collectedAt: -1 });
smartMoneyHistorySchema.index({ _expireAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.SmartMoneyHistory || mongoose.model("SmartMoneyHistory", smartMoneyHistorySchema);
