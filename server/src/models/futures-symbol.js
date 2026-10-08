const mongoose = require("mongoose");

const FuturesSymbolSchema = new mongoose.Schema(
    { symbol: String, exchange: String, tickSize: Number, stepSize: Number },
    { versionKey: false, strict: false, collection: "futures_symbols", autoIndex: false }
);

module.exports = mongoose.model("Futures_Symbol_Web", FuturesSymbolSchema);
