const mongoose = require("mongoose");

// Identity rename only. Never select api_key / api_secret.
const UserApiSchema = new mongoose.Schema(
    {
        username: { type: String },
    },
    {
        versionKey: false,
        strict: false,
        collection: "user_apis",
        autoIndex: false,
    }
);

module.exports = mongoose.model("User_Api", UserApiSchema);
