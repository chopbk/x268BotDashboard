const { WebSocketServer } = require("ws");
const config = require("../config");
const { verifyToken } = require("../auth/token");
const { permissionsForUser, plainScopes } = require("../auth/access-control");
const WebUser = require("../models/web-user");
const { loadPositions } = require("./positions");
const live = require("./position-live");

function readCookie(header, name) {
    const parts = String(header || "").split(/; */);
    for (const part of parts) {
        const index = part.indexOf("=");
        if (index > 0 && part.slice(0, index) === name) return decodeURIComponent(part.slice(index + 1));
    }
    return "";
}

async function userFromUpgrade(req) {
    const token = readCookie(req.headers.cookie, config.cookieName);
    if (!token) return null;
    let payload;
    try {
        payload = verifyToken(token);
    } catch (error) {
        return null;
    }
    if (!payload?.sub) return null;
    const user = await WebUser.findById(payload.sub).select("-passwordHash").lean();
    if (!user || user.disabled) return null;
    return {
        id: String(user._id),
        email: user.email,
        username: user.username || null,
        name: user.name,
        role: user.role,
        customPermissions: user.customPermissions,
        permissionScopes: plainScopes(user.permissionScopes),
        permissions: permissionsForUser(user),
        botUsernames: user.botUsernames || [],
    };
}

function attachPositionSocket(server) {
    const wss = new WebSocketServer({ noServer: true });
    server.on("upgrade", async (req, socket, head) => {
        let pathname = "";
        try {
            pathname = new URL(req.url, "http://localhost").pathname;
        } catch (error) {
            socket.destroy();
            return;
        }
        if (pathname !== "/api/positions/ws") return;
        try {
            const user = await userFromUpgrade(req);
            if (!user) {
                socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
                socket.destroy();
                return;
            }
            wss.handleUpgrade(req, socket, head, (ws) => openSocket(ws, user));
        } catch (error) {
            console.error("[positionWs]", error.message);
            socket.destroy();
        }
    });
}

function openSocket(ws, user) {
    let stop = null;
    const send = (body) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(body));
    };
    ws.on("message", async (raw) => {
        let message;
        try {
            message = JSON.parse(String(raw));
        } catch (error) {
            return;
        }
        if (message?.type === "pause") {
            stop?.();
            stop = null;
            return;
        }
        if (message?.type !== "watch" && message?.type !== "resume") return;
        const account = String(message.account || "").trim();
        if (!account) return;
        const viewQuery = {
            account,
            audience: message.audience === "all" ? "all" : "mine",
            book: message.book || "",
        };
        try {
            await loadPositions(user, viewQuery, { snapshot: async () => null });
        } catch (error) {
            send({ type: "error", error: error.status === 403 ? "Không có quyền với tài khoản này" : "Không xem được vị thế" });
            return;
        }
        stop?.();
        stop = live.watch(account, async (snap) => {
            try {
                const view = await loadPositions(user, viewQuery, { snapshot: async () => snap });
                send({ type: "snapshot", ...view });
            } catch (error) {
                console.error("[positionWs]", error.message);
            }
        });
    });
    ws.on("close", () => {
        stop?.();
        stop = null;
    });
}

module.exports = { attachPositionSocket, readCookie };
