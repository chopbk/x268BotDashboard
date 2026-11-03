const mongoose = require("mongoose");

const schema = new mongoose.Schema(
    {
        eventId: { type: String, required: true, index: true },
        field: { type: String, required: true }, // forecast | previous | actual
        vintageKey: { type: String, required: true },
        numericValue: { type: Number, default: null },
        displayValue: { type: String, default: null },
        unit: { type: String, default: null },
        scale: { type: String, default: null },
        adjustment: { type: String, default: null },
        period: { type: String, default: null },
        source: { type: String, default: null },
        knownAt: { type: Date, default: null },
        firstSeenAt: { type: Date, default: Date.now },
        knownBeforeRelease: { type: Boolean, default: null },
        isTrustedActual: { type: Boolean, default: false },
        kind: { type: String, default: "provider" }, // provider | series_observation
    },
    { collection: "market_economy_event_values", timestamps: true }
);

schema.index({ eventId: 1, field: 1, vintageKey: 1 }, { unique: true });
schema.index({ eventId: 1, field: 1, firstSeenAt: 1 });

module.exports =
    mongoose.models.MarketEconomyEventValue ||
    mongoose.model("MarketEconomyEventValue", schema);
