const mongoose = require("mongoose");

const smartMoneyCollectorStateSchema = new mongoose.Schema(
    {
        _id: { type: String, required: true },
        leaseOwner: { type: String, default: null },
        leaseUntil: { type: Date, default: null },
        status: { type: String, default: "idle" },
        lastRunAt: { type: Date, default: null },
        lastSuccessAt: { type: Date, default: null },
        lastError: { type: String, default: null },
        metrics: { type: mongoose.Schema.Types.Mixed, default: {} },
        coverage: { type: mongoose.Schema.Types.Mixed, default: {} },
        nextDue: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
    { collection: "smart_money_collector_state", timestamps: true }
);

module.exports =
    mongoose.models.SmartMoneyCollectorState ||
    mongoose.model("SmartMoneyCollectorState", smartMoneyCollectorStateSchema);
