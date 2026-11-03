const mongoose = require("mongoose");

const scheduleRevisionSchema = new mongoose.Schema(
    {
        scheduledAt: { type: Date, default: null },
        scheduledDate: { type: String, default: null },
        timePrecision: { type: String, default: "datetime" },
        status: { type: String, default: "scheduled" },
        seenAt: { type: Date, default: Date.now },
        reason: { type: String, default: null },
    },
    { _id: false }
);

const schema = new mongoose.Schema(
    {
        eventId: { type: String, required: true, unique: true },
        releaseGroupId: { type: String, required: true, index: true },
        metricKey: { type: String, required: true },
        source: { type: String, required: true },
        sourceEventId: { type: String, required: true },
        sourceUrl: { type: String, default: null },
        country: { type: String, default: null },
        currency: { type: String, default: null },
        title: { type: String, required: true },
        scheduledAt: { type: Date, default: null },
        scheduledDate: { type: String, default: null },
        timePrecision: { type: String, default: "datetime" },
        impact: { type: String, default: "unknown" },
        referencePeriod: { type: String, default: null },
        status: { type: String, default: "scheduled" },
        coverage: { type: String, default: "partial" },
        scheduleRevisions: { type: [scheduleRevisionSchema], default: [] },
        lastSeenAt: { type: Date, default: Date.now },
    },
    { collection: "market_economy_events", timestamps: true }
);

schema.index({ source: 1, sourceEventId: 1, metricKey: 1 }, { unique: true });
schema.index({ scheduledAt: 1, currency: 1, impact: 1 });
schema.index({ currency: 1, impact: 1, scheduledAt: 1 });

module.exports =
    mongoose.models.MarketEconomyEvent || mongoose.model("MarketEconomyEvent", schema);
