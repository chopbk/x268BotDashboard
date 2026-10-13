const mongoose = require("mongoose");

const BotControlCommandSchema = new mongoose.Schema(
    {
        kind: { type: String, required: true },
        hostId: { type: String, required: true },
        processName: { type: String, required: true },
        profileEnv: { type: String, required: true },
        requestedRevision: { type: Number, required: true },
        requestedBy: {
            userId: { type: String, default: "" },
            email: { type: String, default: "" },
        },
        reason: { type: String, default: "" },
        status: { type: String, default: "queued" },
        statusReason: { type: String, default: "" },
        claimedAt: { type: Date, default: null },
        claimedBy: { type: String, default: "" },
        completedAt: { type: Date, default: null },
        result: { type: mongoose.Schema.Types.Mixed, default: null },
        createdAt: { type: Date, default: Date.now },
        updatedAt: { type: Date, default: Date.now },
    },
    {
        collection: "bot_control_commands",
        versionKey: false,
        timestamps: false,
        strict: false,
        autoIndex: false,
    }
);

module.exports = mongoose.model("Bot_Control_Command_Web", BotControlCommandSchema);
