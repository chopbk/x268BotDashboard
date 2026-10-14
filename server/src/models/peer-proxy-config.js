const mongoose = require("mongoose");

/**
 * Peer tinyproxy — pool + kết quả probe sức khỏe (panel /system).
 * Password chỉ lưu server-side; API GET không trả plaintext.
 */
const peerSchema = new mongoose.Schema(
    {
        ip: { type: String, required: true, trim: true },
        port: { type: Number, default: 13128 },
        enabled: { type: Boolean, default: true },
        label: { type: String, default: "", trim: true },
    },
    { _id: false }
);

const probeResultSchema = new mongoose.Schema(
    {
        ip: String,
        ok: Boolean,
        ms: Number,
        error: { type: String, default: "" },
        at: Date,
    },
    { _id: false }
);

const probeHistorySchema = new mongoose.Schema(
    {
        at: Date,
        ok: Number,
        fail: Number,
        probedBy: String,
        summary: String,
    },
    { _id: false }
);

const schema = new mongoose.Schema(
    {
        key: { type: String, required: true, unique: true, default: "default" },
        peers: { type: [peerSchema], default: [] },
        authUser: { type: String, default: "botpeer", trim: true },
        /** Chỉ ghi khi admin gửi; không trả ra API */
        authPass: { type: String, default: "", select: false },
        hostSelfIp: { type: Map, of: String, default: {} },
        lastProbe: {
            at: Date,
            probedBy: String,
            results: { type: [probeResultSchema], default: [] },
        },
        probeHistory: { type: [probeHistorySchema], default: [] },
        updatedBy: { type: String, default: "" },
    },
    { timestamps: true, versionKey: false, collection: "peer_proxy_config" }
);

module.exports = mongoose.models.PeerProxyConfig || mongoose.model("PeerProxyConfig", schema);
