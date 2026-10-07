const mongoose = require("mongoose");

const SummarySnapshotSchema = new mongoose.Schema(
    {
        _id: { type: String },
        range: { type: String, required: true },
        formulaVersion: { type: String, required: true },
        payload: { type: mongoose.Schema.Types.Mixed, default: null },
        status: { type: String, enum: ["ready", "refreshing", "error"], required: true },
        generatedAt: { type: Date, default: null },
        staleAt: { type: Date, default: null },
        leaseOwner: { type: String, default: null },
        leaseUntil: { type: Date, default: null },
        lastError: { type: String, default: null },
    },
    { versionKey: false, timestamps: true, collection: "web_summary_snapshots", autoIndex: false }
);

module.exports = mongoose.model("Web_Summary_Snapshot", SummarySnapshotSchema);
