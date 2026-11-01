const mongoose = require("mongoose");

const QuantDatasetSchema = new mongoose.Schema(
    {
        datasetId: { type: String, required: true, unique: true },
        actorId: { type: String, required: true, index: true },
        name: { type: String, required: true },
        version: { type: String, default: "1" },
        source: { type: String },
        license: { type: String },
        market: {
            exchange: { type: String, default: "binance" },
            marketType: { type: String, default: "usdt_perp_linear" },
            symbol: String,
            resolution: String,
        },
        range: { from: Date, to: Date },
        gapCoverage: { type: Number },
        checksum: { type: String, required: true },
        capturedAt: { type: Date },
        availabilityNote: { type: String },
        survivorshipBiased: { type: Boolean, default: false },
        bars: { type: Array, default: undefined }, // optional small fixtures only
        pinned: { type: Boolean, default: false },
    },
    { timestamps: true, collection: "web_quant_datasets" }
);

module.exports = mongoose.models.QuantDataset
    || mongoose.model("QuantDataset", QuantDatasetSchema);
