const mongoose = require("mongoose");

const BotProfileSchema = new mongoose.Schema(
    {
        env: { type: String, required: true },
        label: { type: String, default: "" },
        active: { type: Boolean, default: true },
        revision: { type: Number, default: 1 },
        variables: { type: mongoose.Schema.Types.Mixed, default: {} },
        updatedBy: {
            userId: { type: String, default: "" },
            email: { type: String, default: "" },
        },
    },
    {
        collection: "bot_profile",
        versionKey: false,
        timestamps: true,
        strict: false,
        autoIndex: false,
    }
);

module.exports = mongoose.model("Bot_Profile_Web", BotProfileSchema);
