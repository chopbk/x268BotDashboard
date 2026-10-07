const express = require("express");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const config = require("./config");
const { connect } = require("./db");
const { bootstrapAdmin } = require("./auth/bootstrap");
const { requireCsrf } = require("./middleware/csrf");
const { createRateLimit } = require("./middleware/rate-limit");

async function main() {
    try {
        if (!config.mongodb) throw new Error("missing MONGODB");
        if (!config.jwtSecret || config.jwtSecret.length < 16) {
            throw new Error("WEB_JWT_SECRET phải từ 16 ký tự");
        }
        if (!Number.isFinite(config.port) || config.port <= 0) {
            throw new Error("WEB_PORT không hợp lệ");
        }

        await connect(config.mongodb);
        await bootstrapAdmin();

        const app = express();
        app.use(
            cors({
                origin: config.clientOrigin,
                credentials: true,
            })
        );
        app.use(express.json({ limit: "100kb" }));
        app.use(cookieParser());
        app.use(requireCsrf);

        const sensitiveMutationLimit = createRateLimit({
            prefix: "sensitive",
            windowMs: 60 * 1000,
            max: 60,
            identify: (req) => req.cookies?.[config.cookieName],
        });

        app.get("/api/health", (req, res) => {
            res.json({ ok: true });
        });
        app.use("/api/auth", require("./routes/auth"));
        app.use("/api/bots", require("./routes/bots"));
        app.use("/api/user-apis", (req, res, next) => req.method === "GET" ? next() : sensitiveMutationLimit(req, res, next), require("./routes/user-apis"));
        app.use("/api/admin/users", require("./routes/admin-users"));
        app.use("/api/audit-logs", require("./routes/audit-logs"));
        app.use("/api/summary", require("./routes/summary"));
        app.use("/api/signal-history", require("./routes/signal-history"));
        app.use("/api/account-statics", require("./routes/account-statics"));

        app.use((err, req, res, next) => {
            if (err.type === "entity.parse.failed") {
                return res.status(400).json({ error: "JSON không hợp lệ" });
            }
            console.error("[errorHandler]", err);
            res.status(500).json({ error: "Internal error" });
        });

        app.listen(config.port, () => {
            console.log("[main] listen", config.port);
        });
    } catch (error) {
        console.error("[main]", error.message || error);
        process.exit(1);
    }
}

main();
