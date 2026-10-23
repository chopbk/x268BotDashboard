const mongoose = require("mongoose");

const schema = new mongoose.Schema(
    {
        kind: { type: String, required: true, index: true },
        symbol: { type: String, default: null, index: true },
        setup: { type: String, default: null },
        timeframe: { type: String, default: null },
        payload: { type: mongoose.Schema.Types.Mixed, default: null },
        cooldownKey: { type: String, required: true, index: true },
        sentAt: { type: Date, default: Date.now, index: true },
        dryRun: { type: Boolean, default: false },
        ok: { type: Boolean, default: true },
        error: { type: String, default: null },
    },
    { collection: "market_dash_alert_log", timestamps: false }
);

schema.index({ cooldownKey: 1, sentAt: -1 });

module.exports =
    mongoose.models.MarketDashAlertLog || mongoose.model("MarketDashAlertLog", schema);
