const mongoose = require("mongoose");

// Shared with binance-bot Mqtt_Config. Read-only for broker URL/topics.
const MqttConfigSchema = new mongoose.Schema(
    {
        env: { type: String },
        topics: { type: [String], default: undefined },
        topics2: { type: [String], default: undefined },
        url: String,
        externalUrl: String,
    },
    {
        versionKey: false,
        strict: false,
        collection: "mqtt_configs",
        autoIndex: false,
    }
);

module.exports = mongoose.model("Mqtt_Config", MqttConfigSchema);
