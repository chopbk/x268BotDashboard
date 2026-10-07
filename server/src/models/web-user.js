const mongoose = require("mongoose");
const { PERMISSIONS, ROLES } = require("../auth/access-control");

const WebUserSchema = new mongoose.Schema(
    {
        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
            index: true,
        },
        username: {
            type: String,
            unique: true,
            sparse: true,
            lowercase: true,
            trim: true,
            index: true,
        },
        telegramId: {
            type: String,
            unique: true,
            sparse: true,
            trim: true,
            index: true,
        },
        telegramUsername: {
            type: String,
            lowercase: true,
            trim: true,
        },
        phone: {
            type: String,
            trim: true,
        },
        passwordHash: {
            type: String,
            required: true,
        },
        name: {
            type: String,
            required: true,
            trim: true,
        },
        role: {
            type: String,
            enum: ROLES,
            default: "viewer",
            required: true,
        },
        customPermissions: {
            type: [String],
            enum: Object.values(PERMISSIONS),
            default: undefined,
        },
        botUsernames: {
            type: [String],
            default: [],
        },
        disabled: {
            type: Boolean,
            default: false,
        },
    },
    {
        versionKey: false,
        timestamps: true,
        collection: "web_users",
    }
);

module.exports = mongoose.model("Web_User", WebUserSchema);
