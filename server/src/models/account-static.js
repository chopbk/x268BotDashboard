const mongoose = require("mongoose");

const AccountStaticSchema = new mongoose.Schema(
    {
        env: String, typeSignal: String, symbol: String, side: String,
        entryPrice: Number, closePrice: Number, futuresLeverage: Number,
        costAmount: Number, positionAmt: Number, volume: Number,
        openTime: Date, closeTime: Date, status: String, roe: Number, profit: Number,
        isCopy: Boolean, isLimit: Boolean, isClosed: Boolean, isPaper: Boolean,
    },
    { versionKey: false, strict: false, collection: "account_statics", autoIndex: false }
);

module.exports = mongoose.model("Account_Static_Web", AccountStaticSchema);
