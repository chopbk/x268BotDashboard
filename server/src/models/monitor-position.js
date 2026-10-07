const mongoose = require("mongoose");

const MonitorPositionSchema = new mongoose.Schema(
    { env: String, closed: Boolean, isClosed: Boolean, isPaper: Boolean },
    { versionKey: false, strict: false, collection: "monitor_positions", autoIndex: false }
);

module.exports = mongoose.model("Monitor_Position_Web", MonitorPositionSchema);
