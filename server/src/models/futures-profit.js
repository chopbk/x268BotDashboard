const mongoose = require("mongoose");

const FuturesProfitSchema = new mongoose.Schema(
    { env: String, day: Date, profit: Number },
    { versionKey: false, strict: false, collection: "futures_profits", autoIndex: false }
);

module.exports = mongoose.model("Futures_Profit_Web", FuturesProfitSchema);
