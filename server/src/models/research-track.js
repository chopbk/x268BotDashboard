const mongoose = require("mongoose");

const ResearchTrackSchema = new mongoose.Schema(
    {
        ownerUserId: { type: String, required: true, index: true },
        title: { type: String, required: true, maxlength: 120 },
        note: { type: String, default: "", maxlength: 2000 },
        status: {
            type: String,
            enum: ["watching", "paused", "terminal", "archived"],
            default: "watching",
            index: true,
        },
        terminalReason: String,
        source: {
            exchange: { type: String, default: "binance" },
            marketType: { type: String, default: "usdt_perp_linear" },
            symbol: String,
            timeframe: String,
            setupId: String,
            setupVersion: String,
        },
        baseline: { type: mongoose.Schema.Types.Mixed, default: null },
        lastObservation: { type: mongoose.Schema.Types.Mixed, default: null },
        dataQuality: { type: String, enum: ["fresh", "stale", "missing", "incompatible"], default: "fresh" },
        expiresAt: Date,
        revision: { type: Number, default: 1 },
        pendingEvents: { type: [mongoose.Schema.Types.Mixed], default: [] },
        lastCheckedAt: Date,
    },
    { versionKey: false, timestamps: true, collection: "web_research_tracks" }
);

ResearchTrackSchema.index(
    { ownerUserId: 1, "source.setupId": 1, status: 1 },
    { unique: true, partialFilterExpression: { status: { $in: ["watching", "paused"] } } }
);

module.exports = mongoose.models.ResearchTrack
    || mongoose.model("ResearchTrack", ResearchTrackSchema);
