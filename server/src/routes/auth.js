const express = require("express");
const WebUser = require("../models/web-user");
const { hashPassword, verifyPassword } = require("../auth/password");
const { signToken, setAuthCookie, clearAuthCookie } = require("../auth/token");
const { requireAuth } = require("../middleware/auth");
const {
    normalizeEmail,
    isValidEmail,
    normalizeUsername,
    isValidUsername,
} = require("../lib/validate");
const { sessionUser } = require("../lib/public-user");
const { safeRecordAudit } = require("../lib/audit");
const { sendError } = require("../lib/http");
const { issueCsrfToken } = require("../middleware/csrf");
const { createRateLimit } = require("../middleware/rate-limit");

const router = express.Router();
const LOGIN_ERROR = "Email/username hoặc mật khẩu không đúng";
const loginLimit = createRateLimit({ windowMs: 15 * 60 * 1000, max: 10, prefix: "login", identify: (req) => req.body?.identifier ?? req.body?.email });
const registerLimit = createRateLimit({ windowMs: 60 * 60 * 1000, max: 5, prefix: "register", identify: (req) => `${req.body?.email || ""}:${req.body?.username || ""}` });

router.get("/csrf", issueCsrfToken);
router.use("/register", registerLimit);
router.use("/login", loginLimit);

router.post("/register", async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const username = normalizeUsername(req.body?.username);
    const name = String(req.body?.name || "").trim();
    const password = req.body?.password;
    try {
        if (!isValidEmail(email)) {
            return res.status(400).json({ error: "Email không hợp lệ" });
        }
        if (!isValidUsername(username)) {
            return res.status(400).json({
                error: "Username phải từ 3-32 ký tự, chỉ gồm chữ thường, số, dấu chấm, gạch dưới hoặc gạch ngang",
            });
        }
        if (!name) return res.status(400).json({ error: "Thiếu tên" });
        if (typeof password !== "string" || password.length < 8) {
            return res.status(400).json({ error: "Mật khẩu phải từ 8 ký tự" });
        }

        const user = await WebUser.create({
            email,
            username,
            name,
            passwordHash: await hashPassword(password),
            role: "pending",
            botUsernames: [],
            disabled: false,
        });
        await safeRecordAudit({
            action: "user.registered",
            actor: user,
            targetType: "user",
            target: user,
            changes: { role: { from: null, to: "pending" } },
        });
        setAuthCookie(res, signToken(user._id));
        res.status(201).json(sessionUser(user));
    } catch (error) {
        if (error?.code === 11000) {
            const [emailOwner, usernameOwner] = await Promise.all([
                WebUser.findOne({ email }),
                WebUser.findOne({ username }),
            ]);
            const passwordOk = await verifyPassword(password, emailOwner?.passwordHash);
            const sameUsernameOwner =
                !usernameOwner || String(usernameOwner._id) === String(emailOwner?._id);
            const usernameMatches = !emailOwner?.username || emailOwner.username === username;
            if (
                emailOwner?.role === "pending" &&
                !emailOwner.disabled &&
                passwordOk &&
                sameUsernameOwner &&
                usernameMatches
            ) {
                if (!emailOwner.username) {
                    emailOwner.username = username;
                    await emailOwner.save();
                    await safeRecordAudit({
                        action: "user.username_linked",
                        actor: emailOwner,
                        targetType: "user",
                        target: emailOwner,
                        changes: { username: { from: null, to: username } },
                    });
                }
                setAuthCookie(res, signToken(emailOwner._id));
                return res.json(sessionUser(emailOwner));
            }
            return res.status(409).json({ error: "Email hoặc username đã được sử dụng" });
        }
        sendError(res, error, "POST /api/auth/register");
    }
});

router.post("/login", async (req, res) => {
    try {
        const identifier = normalizeUsername(req.body?.identifier ?? req.body?.email);
        const password = req.body?.password;
        const query = isValidEmail(identifier)
            ? { email: identifier }
            : isValidUsername(identifier)
              ? { username: identifier }
              : null;
        if (!query || typeof password !== "string" || !password) {
            console.log("[POST /api/auth/login] rejected");
            return res.status(401).json({ error: LOGIN_ERROR });
        }

        const user = await WebUser.findOne(query);
        const passwordOk = await verifyPassword(password, user?.passwordHash);
        if (!user || !passwordOk || user.disabled) {
            console.log("[POST /api/auth/login] rejected");
            return res.status(401).json({ error: LOGIN_ERROR });
        }

        setAuthCookie(res, signToken(user._id));
        res.json(sessionUser(user));
    } catch (error) {
        sendError(res, error, "POST /api/auth/login");
    }
});

router.post("/logout", (req, res) => {
    try {
        clearAuthCookie(res);
        res.json({ ok: true });
    } catch (error) {
        sendError(res, error, "POST /api/auth/logout");
    }
});

router.get("/me", requireAuth, (req, res) => {
    try {
        res.json(sessionUser(req.webUser));
    } catch (error) {
        sendError(res, error, "GET /api/auth/me");
    }
});

module.exports = router;
