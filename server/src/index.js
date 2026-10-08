const express = require("express");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const config = require("./config");
const { connect } = require("./db");
const { bootstrapAdmin } = require("./auth/bootstrap");
const { requireCsrf } = require("./middleware/csrf");
const { createRateLimit, endpointKey, requestIp } = require("./middleware/rate-limit");
const { createConcurrencyLimit, requestTimeout, sessionIdentity } = require("./middleware/request-guards");
const { startSummarySnapshotJob } = require("./lib/summary-snapshots");
const { connectRateLimitStore, rateLimitStoreStatus } = require("./lib/rate-limit-store");

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
        await connectRateLimitStore(config.redisUrl);
        await bootstrapAdmin();
        await startSummarySnapshotJob();

        const app = express();
        if (config.trustProxy) app.set("trust proxy", 1);
        app.use(
            cors({
                origin: config.clientOrigin,
                credentials: true,
            })
        );
        app.use(express.json({ limit: "100kb" }));
        app.use(cookieParser());
        app.use("/api", requestTimeout(30_000));
        app.use("/api", createConcurrencyLimit({ max: 40 }));
        app.use("/api", createConcurrencyLimit({
            max: 8,
            identify: (req) => {
                const identity = sessionIdentity(req, config.cookieName);
                return identity === "anonymous" ? `anonymous:${requestIp(req)}` : identity;
            },
        }));
        app.use("/api", createRateLimit({ windowMs: 5 * 60 * 1000, max: 300, prefix: "global" }));
        app.use("/api", createRateLimit({
            windowMs: 60 * 1000,
            max: 60,
            prefix: "endpoint",
            identify: (req) => `${sessionIdentity(req, config.cookieName)}:${endpointKey(req)}`,
        }));
        app.use(requireCsrf);

        const sensitiveMutationLimit = createRateLimit({
            prefix: "sensitive",
            windowMs: 60 * 1000,
            max: 60,
            identify: (req) => req.cookies?.[config.cookieName],
        });

        app.get("/api/health", (req, res) => {
            res.json({ ok: true, rateLimitStore: rateLimitStoreStatus() });
        });
        app.use("/api/auth", require("./routes/auth"));
        app.use("/api/bots", (req, res, next) => req.method === "GET" ? next() : sensitiveMutationLimit(req, res, next), require("./routes/bots"));
        app.use("/api/user-apis", (req, res, next) => req.method === "GET" ? next() : sensitiveMutationLimit(req, res, next), require("./routes/user-apis"));
        app.use("/api/admin/users", (req, res, next) => req.method === "GET" ? next() : sensitiveMutationLimit(req, res, next), require("./routes/admin-users"));
        app.use("/api/audit-logs", require("./routes/audit-logs"));
        app.use("/api/runtime-logs", require("./routes/runtime-logs"));
        app.use("/api/system-health", require("./routes/system-health"));
        app.use("/api/summary", require("./routes/summary"));
        app.use("/api/signal-history", require("./routes/signal-history"));
        app.use("/api/signal-config", (req, res, next) => req.method === "GET" ? next() : sensitiveMutationLimit(req, res, next), require("./routes/signal-setup"));
        app.use("/api/account-statics", require("./routes/account-statics"));
        app.use("/api/account-ledger", (req, res, next) => req.method === "GET" ? next() : sensitiveMutationLimit(req, res, next), require("./routes/account-ledger"));

        app.use((err, req, res, next) => {
            if (err.type === "entity.too.large") {
                return res.status(413).json({ error: "Request vượt quá kích thước cho phép" });
            }
            if (err.type === "entity.parse.failed") {
                return res.status(400).json({ error: "JSON không hợp lệ" });
            }
            console.error("[errorHandler]", err);
            res.status(500).json({ error: "Internal error" });
        });

        const server = app.listen(config.port, config.host, () => {
            console.log("[main] listen", config.port);
        });
        server.requestTimeout = 35_000;
        server.headersTimeout = 10_000;
        server.keepAliveTimeout = 5_000;
    } catch (error) {
        console.error("[main]", error.message || error);
        process.exit(1);
    }
}

main();
