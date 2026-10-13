const mongoose = require("mongoose");

const TelegramConfigSchema = new mongoose.Schema(
    { env: { type: String } },
    {
        versionKey: false,
        strict: false,
        collection: "telegram_configs",
        autoIndex: false,
    }
);

module.exports = mongoose.model("Telegram_Config_Web", TelegramConfigSchema);
