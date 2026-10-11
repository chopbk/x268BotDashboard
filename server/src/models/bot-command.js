const mongoose = require("mongoose");

const STATUSES = Object.freeze([
    "queued",
    "published",
    "received",
    "running",
    "succeeded",
    "failed",
    "expired",
]);

const RoleAckSchema = new mongoose.Schema(
    {
        status: String,
        terminal: { type: Boolean, default: false },
        instanceId: String,
        applied: { type: [String], default: undefined },
        skipped: { type: [String], default: undefined },
        failed: { type: [mongoose.Schema.Types.Mixed], default: undefined },
        message: String,
        error: mongoose.Schema.Types.Mixed,
        timestamp: Number,
        at: { type: Date, default: Date.now },
    },
    { _id: false }
);

const BotCommandSchema = new mongoose.Schema(
    {
        requestId: { type: String, required: true, unique: true },
        username: { type: String, required: true, index: true },
        targetEnv: { type: String, required: true, index: true },
        action: { type: String, required: true, index: true },
        category: { type: String, enum: ["config_sync", "command", "trading"], default: "config_sync", index: true },
        idempotencyKey: { type: String, sparse: true, index: true },
        params: { type: mongoose.Schema.Types.Mixed, default: {} },
        mappedCommand: { type: String, default: "" },
        status: { type: String, enum: STATUSES, default: "queued", index: true },
        terminal: { type: Boolean, default: false },
        /** Roles bắt buộc ACK terminal trước khi coi succeeded (APPLY_CONFIG mặc định TRADER). */
        requiredRoles: { type: [String], default: () => ["TRADER"] },
        roleAcks: { type: Map, of: RoleAckSchema, default: () => new Map() },
        messages: {
            type: [
                {
                    status: String,
                    message: String,
                    error: mongoose.Schema.Types.Mixed,
                    processRole: String,
                    instanceId: String,
                    timestamp: Number,
                    at: { type: Date, default: Date.now },
                    /** mongo_bot | mqtt */
                    ackChannel: String,
                },
            ],
            default: [],
        },
        error: { type: mongoose.Schema.Types.Mixed, default: null },
        actorUserId: { type: String, default: "" },
        actorUsername: { type: String, default: "" },
        publishedAt: { type: Date, default: null },
        expiresAt: { type: Date, required: true },
        attempt: { type: Number, default: 1 },
        /** requestId lệnh failed/expired được retry (liên kết audit). */
        retryOfRequestId: { type: String, default: null, index: true },
        /**
         * Kênh ACK gần nhất ghi vào outbox:
         * - mongo_bot: binance-bot ghi trực tiếp (source of truth cho poll/wait)
         * - mqtt: web apply từ MQTT command_response (phụ)
         */
        lastAckChannel: { type: String, default: null },
    },
    {
        versionKey: false,
        timestamps: true,
        collection: "web_bot_commands",
    }
);

BotCommandSchema.index({ createdAt: -1 });
BotCommandSchema.index({ expiresAt: 1 });

module.exports = mongoose.model("Web_Bot_Command", BotCommandSchema);
module.exports.STATUSES = STATUSES;
