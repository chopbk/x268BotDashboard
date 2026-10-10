const mongoose = require("mongoose");

const STATUSES = Object.freeze([
    "queued",
    "published",
    "received",
    "running",
    "succeeded",
    "failed",
    "expired",
]);

const BotCommandSchema = new mongoose.Schema(
    {
        requestId: { type: String, required: true, unique: true },
        username: { type: String, required: true, index: true },
        targetEnv: { type: String, required: true, index: true },
        action: { type: String, required: true, index: true },
        params: { type: mongoose.Schema.Types.Mixed, default: {} },
        mappedCommand: { type: String, default: "" },
        status: { type: String, enum: STATUSES, default: "queued", index: true },
        terminal: { type: Boolean, default: false },
        messages: {
            type: [
                {
                    status: String,
                    message: String,
                    error: mongoose.Schema.Types.Mixed,
                    timestamp: Number,
                    at: { type: Date, default: Date.now },
                },
            ],
            default: [],
        },
        error: { type: mongoose.Schema.Types.Mixed, default: null },
        actorUserId: { type: String, default: "" },
        actorUsername: { type: String, default: "" },
        publishedAt: { type: Date, default: null },
        expiresAt: { type: Date, required: true },
        attempt: { type: Number, default: 1 },
    },
    {
        versionKey: false,
        timestamps: true,
        collection: "web_bot_commands",
    }
);

BotCommandSchema.index({ createdAt: -1 });
BotCommandSchema.index({ expiresAt: 1 });

module.exports = mongoose.model("Web_Bot_Command", BotCommandSchema);
module.exports.STATUSES = STATUSES;
