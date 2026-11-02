const mongoose = require("mongoose");

/** Soft lock ngắn để serialize reserveBudget theo account. */
const RiskAccountLockSchema = new mongoose.Schema(
    {
        account: { type: String, required: true, unique: true },
        leaseOwner: { type: String, default: null },
        leaseUntil: { type: Date, default: null, index: true },
    },
    { versionKey: false, timestamps: true, collection: "web_risk_account_locks" }
);

module.exports = mongoose.models.RiskAccountLock
    || mongoose.model("RiskAccountLock", RiskAccountLockSchema);
