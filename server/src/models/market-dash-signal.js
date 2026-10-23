const mongoose = require("mongoose");

const schema = new mongoose.Schema(
    {
        symbol: { type: String, required: true, index: true },
        setup: { type: String, required: true, index: true },
        timeframe: { type: String, required: true, index: true },
        direction: { type: String, enum: ["long", "short"], required: true },
        scoreRaw: { type: Number, default: null },
        score: { type: Number, default: null },
        scoreBreakdown: { type: mongoose.Schema.Types.Mixed, default: null },
        entry: { type: Number, default: null },
        stopLoss: { type: Number, default: null },
        takeProfit: { type: Number, default: null },
        rr: { type: Number, default: null },
        entryZone: { type: mongoose.Schema.Types.Mixed, default: null },
        checklist: { type: [mongoose.Schema.Types.Mixed], default: [] },
        funding: { type: Number, default: null },
        oiDelta24h: { type: Number, default: null },
        rs7d: { type: Number, default: null },
        volSpike: { type: Number, default: null },
        price: { type: Number, default: null },
        change24h: { type: Number, default: null },
        signalTime: { type: Date, required: true, index: true },
        candleCloseTime: { type: Number, required: true },
        active: { type: Boolean, default: true, index: true },
        resetAt: { type: Date, default: null },
        regimeBtc1d: { type: String, default: null },
        mfe1h: { type: Number, default: null },
        mae1h: { type: Number, default: null },
        mfe4h: { type: Number, default: null },
        mae4h: { type: Number, default: null },
        mfe24h: { type: Number, default: null },
        mae24h: { type: Number, default: null },
        formulaVersion: { type: String, default: "mdash-v1" },
    },
    { collection: "market_dash_signals", timestamps: true }
);

schema.index({ symbol: 1, setup: 1, timeframe: 1, active: 1 });
schema.index({ score: -1, signalTime: -1 });

module.exports =
    mongoose.models.MarketDashSignal || mongoose.model("MarketDashSignal", schema);
