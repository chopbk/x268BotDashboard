const mongoose = require("mongoose");

const SignalInfoSchema = new mongoose.Schema(
    {
        signal: String,
        status: String,
        side: String,
        symbol: String,
        type: String,
        openTime: Date,
    },
    {
        versionKey: false,
        strict: false,
        collection: "signal_infos",
        autoIndex: false,
    }
);

module.exports = mongoose.model("Signal_Infos_Web", SignalInfoSchema);
