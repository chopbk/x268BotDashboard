const mongoose = require("mongoose");

const IdentitySchema = new mongoose.Schema(
    {
        id: String,
        email: String,
        username: String,
        name: String,
        type: { type: String, enum: ["user", "system"], default: "user" },
    },
    { _id: false }
);

const AuditLogSchema = new mongoose.Schema(
    {
        action: { type: String, required: true, index: true },
        actor: { type: IdentitySchema, required: true },
        targetType: { type: String, required: true, index: true },
        target: { type: IdentitySchema, required: true },
        changes: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
    {
        versionKey: false,
        timestamps: { createdAt: true, updatedAt: false },
        collection: "web_audit_logs",
    }
);

AuditLogSchema.index({ createdAt: -1, _id: -1 });
AuditLogSchema.index({ "target.id": 1, createdAt: -1 });

module.exports = mongoose.model("Web_Audit_Log", AuditLogSchema);
