const mongoose = require("mongoose");

const TelegramClientSchema = new mongoose.Schema(
    {},
    {
        versionKey: false,
        strict: false,
        collection: "telegram_clients",
        autoIndex: false,
    }
);

module.exports = mongoose.model("Telegram_Client_Web", TelegramClientSchema);
