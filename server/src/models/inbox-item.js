const mongoose = require("mongoose");

const InboxItemSchema = new mongoose.Schema(
    {
        ownerUserId: { type: String, required: true, index: true },
        source: { type: String, required: true },
        sourceEventId: { type: String, required: true },
        kind: { type: String, required: true },
        title: { type: String, required: true, maxlength: 200 },
        body: { type: String, default: "", maxlength: 2000 },
        resourceType: { type: String, default: "research_track" },
        resourceId: String,
        occurredAt: Date,
        detectedAt: { type: Date, default: Date.now },
        readAt: Date,
        archivedAt: Date,
        evidence: { type: mongoose.Schema.Types.Mixed, default: null },
    },
    { versionKey: false, timestamps: true, collection: "web_inbox_items" }
);

InboxItemSchema.index({ ownerUserId: 1, source: 1, sourceEventId: 1 }, { unique: true });
InboxItemSchema.index({ ownerUserId: 1, readAt: 1, createdAt: -1 });

module.exports = mongoose.models.InboxItem || mongoose.model("InboxItem", InboxItemSchema);
