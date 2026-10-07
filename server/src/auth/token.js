const jwt = require("jsonwebtoken");
const config = require("../config");

function cookieOptions() {
    return {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
    };
}

function signToken(userId) {
    return jwt.sign({ sub: String(userId) }, config.jwtSecret, {
        expiresIn: config.jwtExpiresIn,
    });
}

function verifyToken(token) {
    return jwt.verify(token, config.jwtSecret);
}

function setAuthCookie(res, token) {
    res.cookie(config.cookieName, token, {
        ...cookieOptions(),
        maxAge: config.cookieMaxAgeMs,
    });
}

function clearAuthCookie(res) {
    res.clearCookie(config.cookieName, cookieOptions());
}

module.exports = { signToken, verifyToken, setAuthCookie, clearAuthCookie };
