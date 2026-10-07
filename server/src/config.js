const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../../.env") });

const config = {
    mongodb: process.env.MONGODB || "",
    port: Number(process.env.WEB_PORT || 4000),
    jwtSecret: process.env.WEB_JWT_SECRET || "",
    adminEmail: String(process.env.WEB_ADMIN_EMAIL || "")
        .trim()
        .toLowerCase(),
    adminPassword: process.env.WEB_ADMIN_PASSWORD || "",
    clientOrigin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
    cookieName: "wb_token",
    jwtExpiresIn: "12h",
    cookieMaxAgeMs: 12 * 60 * 60 * 1000,
};

module.exports = config;
