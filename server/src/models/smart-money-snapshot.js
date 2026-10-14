const mongoose = require("mongoose");

/** Snapshot mới nhất theo symbol — nguồn bền; Redis chỉ cache. */
const smartMoneySnapshotSchema = new mongoose.Schema(
    {
        symbol: { type: String, required: true, unique: true },
        collectedAt: { type: Date, required: true, index: true },
        schemaVersion: { type: String, required: true },
        qualityOverall: { type: String, default: null },
        cohortId: { type: String, default: null },
        signalDay: { type: Number, default: null },
        snapshot: { type: mongoose.Schema.Types.Mixed, required: true },
        updatedAt: { type: Date, default: Date.now },
    },
    { collection: "smart_money_snapshots", timestamps: false }
);

smartMoneySnapshotSchema.index({ updatedAt: -1 });

module.exports =
    mongoose.models.SmartMoneySnapshot || mongoose.model("SmartMoneySnapshot", smartMoneySnapshotSchema);
