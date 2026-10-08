const mongoose = require("mongoose");

const ProcessHeartbeatSchema = new mongoose.Schema(
    {},
    { versionKey: false, strict: false, collection: "bot_heartbeats", autoIndex: false }
);

module.exports = mongoose.model("Process_Heartbeat_Web", ProcessHeartbeatSchema);
