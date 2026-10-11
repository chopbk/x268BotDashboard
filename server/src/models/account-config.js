const mongoose = require("mongoose");

// Write path for binance-bot Account_Config. autoIndex stays off so this
// process does not rebuild the bot's indexes.
const AccountConfigSchema = new mongoose.Schema(
    {
        env: { type: String },
        blacklist: { type: [String], default: undefined },
        whitelist: { type: [String], default: undefined },
        signals: { type: [String], default: undefined },
        trade_config: { type: Object, default: undefined },
        // Phải khai báo: mongoose.set("strictQuery", true) sẽ strip field
        // ngoài schema → find({ sync_from }) thành find({}) (gửi cả DB qua MQTT).
        sync_from: { type: String, default: undefined },
        sync_except: { type: [String], default: undefined },
        sync_scale: { type: Boolean, default: undefined },
        sync_margin_ratio: { type: Number, default: undefined },
        sync_wallet_bal: { type: Number, default: undefined },
        sync_size: { type: Object, default: undefined },
    },
    {
        versionKey: false,
        strict: false,
        collection: "account_configs",
        autoIndex: false,
    }
);

module.exports = mongoose.model("Account_Config", AccountConfigSchema);
