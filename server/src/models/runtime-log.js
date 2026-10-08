const mongoose = require("mongoose");

const RuntimeLogSchema = new mongoose.Schema(
    {
        at: Date,
        level: String,
        category: String,
        role: String,
        processName: String,
        pmId: String,
        usernames: [String],
        env: String,
        symbol: String,
        signal: String,
        source: String,
        message: String,
    },
    {
        versionKey: false,
        strict: false,
        collection: "bot_runtime_logs",
        autoIndex: false,
    }
);

module.exports = mongoose.model("Runtime_Log_Web", RuntimeLogSchema);
