const mongoose = require("mongoose");

const ChildSchema = new mongoose.Schema({
    childId: { type: String, required: true },
    status: {
        type: String,
        enum: ["pending", "submitted", "filled", "cancelled", "unknown"],
        default: "pending",
    },
    quantity: { type: Number },
    filledQty: { type: Number, default: 0 },
    exchangeOrderId: { type: String },
    reservationId: { type: String },
}, { _id: false });

const AlgoOrderSchema = new mongoose.Schema(
    {
        algoId: { type: String, required: true, unique: true },
        actorId: { type: String, required: true, index: true },
        account: { type: String, required: true, index: true },
        symbol: { type: String, required: true },
        side: { type: String },
        positionSide: { type: String },
        type: {
            type: String,
            enum: ["TWAP", "PARTICIPATION", "VWAP"],
            required: true,
        },
        parentQuantity: { type: Number, required: true },
        filledQty: { type: Number, default: 0 },
        outstandingQty: { type: Number, default: 0 },
        status: {
            type: String,
            enum: ["draft", "active", "paused", "cancelling", "cancelled", "completed", "failed"],
            default: "draft",
        },
        params: { type: mongoose.Schema.Types.Mixed },
        children: { type: [ChildSchema], default: [] },
        reservationId: { type: String },
        liveExecution: { type: Boolean, default: false },
        maxDurationMs: { type: Number },
        maxDeviationBps: { type: Number },
        note: { type: String },
    },
    { timestamps: true, collection: "web_algo_orders" }
);

module.exports = mongoose.models.AlgoOrder
    || mongoose.model("AlgoOrder", AlgoOrderSchema);
