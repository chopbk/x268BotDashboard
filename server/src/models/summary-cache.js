const mongoose = require("mongoose");

const SummaryCacheSchema = new mongoose.Schema(
    {
        _id: { type: String },
        payload: { type: mongoose.Schema.Types.Mixed, required: true },
        generatedAt: { type: Date, required: true },
        expiresAt: { type: Date, required: true },
    },
    { versionKey: false, collection: "web_summary_cache", autoIndex: false }
);

module.exports = mongoose.model("Web_Summary_Cache", SummaryCacheSchema);
