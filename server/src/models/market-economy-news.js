const mongoose = require("mongoose");

const schema = new mongoose.Schema(
    {
        canonicalUrlHash: { type: String, required: true },
        providerArticleId: { type: String, default: null },
        title: { type: String, required: true },
        publisher: { type: String, default: null },
        sourceId: { type: String, required: true },
        canonicalUrl: { type: String, required: true },
        publishedAt: { type: Date, default: null },
        collectedAt: { type: Date, default: Date.now },
        topic: { type: String, default: "crypto" },
        locale: { type: String, default: "vi" },
        assetIds: { type: [String], default: [] },
        expiresAt: { type: Date, default: null },
    },
    { collection: "market_economy_news", timestamps: true }
);

schema.index({ canonicalUrlHash: 1 }, { unique: true });
schema.index({ publishedAt: -1, _id: -1 });
schema.index({ topic: 1, publishedAt: -1 });
schema.index({ assetIds: 1, publishedAt: -1 });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports =
    mongoose.models.MarketEconomyNews || mongoose.model("MarketEconomyNews", schema);
