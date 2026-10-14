const mongoose = require("mongoose");

/**
 * Fleet peer-proxy (tinyproxy) — cấu hình dùng chung để bật BINANCE_PEER_* trên bot_profile.
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

const schema = new mongoose.Schema(
    {
        key: { type: String, required: true, unique: true, default: "default" },
        peers: { type: [peerSchema], default: [] },
        authUser: { type: String, default: "botpeer", trim: true },
        /** Chỉ ghi khi admin gửi; không trả ra API */
        authPass: { type: String, default: "", select: false },
        /** hostId (heartbeat) → IP public của máy đó */
        hostSelfIp: { type: Map, of: String, default: {} },
        updatedBy: { type: String, default: "" },
    },
    { timestamps: true, versionKey: false, collection: "peer_proxy_config" }
);

module.exports = mongoose.models.PeerProxyConfig || mongoose.model("PeerProxyConfig", schema);
