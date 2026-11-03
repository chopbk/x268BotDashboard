const mongoose = require("mongoose");

const schema = new mongoose.Schema(
    {
        metricId: { type: String, required: true, index: true },
        source: { type: String, required: true },
        observationPeriod: { type: String, required: true },
        vintageKey: { type: String, required: true, default: "latest" },
        value: { type: Number, default: null },
        unit: { type: String, default: null },
        displayValue: { type: String, default: null },
        sourceSeriesId: { type: String, default: null },
        sourceUrl: { type: String, default: null },
        observationDate: { type: String, default: null },
        referencePeriod: { type: String, default: null },
        sourceAsOf: { type: String, default: null },
        observedAt: { type: Date, default: null },
        lastSuccessfulFetchAt: { type: Date, default: null },
        lastAttemptAt: { type: Date, default: null },
        frequency: { type: String, default: null },
        quality: { type: String, default: "missing" },
        marketState: { type: String, default: null },
        reason: { type: String, default: null },
        previousValue: { type: Number, default: null },
        previousObservationDate: { type: String, default: null },
        deltaBp: { type: Number, default: null },
        historical: { type: Boolean, default: false },
        payload: { type: mongoose.Schema.Types.Mixed, default: null },
    },
    { collection: "market_economy_metrics", timestamps: true }
);

schema.index(
    { metricId: 1, source: 1, observationPeriod: 1, vintageKey: 1 },
    { unique: true }
);
schema.index({ metricId: 1, observationDate: -1 });

module.exports =
    mongoose.models.MarketEconomyMetric || mongoose.model("MarketEconomyMetric", schema);
