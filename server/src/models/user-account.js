const mongoose = require("mongoose");

// Read-only view of binance-bot User_Account. Do not read User_Api (api keys).
const UserAccountSchema = new mongoose.Schema(
    {
        username: {
            type: String,
            index: true,
        },
        accounts: [{ type: String }],
        ownerUserId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Web_User",
            default: null,
        },
        visibility: {
            type: String,
            enum: ["public", "private"],
            default: "public",
        },
        active: {
            type: Boolean,
            default: true,
        },
    },
    {
        versionKey: false,
        collection: "user_accounts",
        autoIndex: false,
    }
);

module.exports = mongoose.model("User_Account", UserAccountSchema);
