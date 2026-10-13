const mongoose = require("mongoose");

const BotProfileRevisionSchema = new mongoose.Schema(
    {
        profileEnv: { type: String, required: true },
        revision: { type: Number, required: true },
        action: { type: String, default: "update" },
        variables: { type: mongoose.Schema.Types.Mixed, default: {} },
        diff: { type: Array, default: [] },
        reason: { type: String, default: "" },
        actor: {
            userId: { type: String, default: "" },
            email: { type: String, default: "" },
        },
        createdAt: { type: Date, default: Date.now },
    },
    {
        collection: "bot_profile_revisions",
        versionKey: false,
        timestamps: false,
        strict: false,
        autoIndex: false,
    }
);

module.exports = mongoose.model("Bot_Profile_Revision_Web", BotProfileRevisionSchema);
