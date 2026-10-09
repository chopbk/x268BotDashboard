const { WebSocketServer } = require("ws");
const config = require("../config");
const { verifyToken } = require("../auth/token");
const { permissionsForUser, plainScopes } = require("../auth/access-control");
const WebUser = require("../models/web-user");
const { loadPositions } = require("./positions");
const live = require("./position-live");
const { markOf } = require("./mark-prices");

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
            wss.handleUpgrade(req, socket, head, (ws) => openSocket(ws, user, { authenticate: () => userFromUpgrade(req) }));
        } catch (error) {
            console.error("[positionWs]", error.message);
            socket.destroy();
        }
    });
}

function openSocket(ws, user, deps = {}) {
    const load = deps.loadPositions || loadPositions;
    const source = deps.live || live;
    let generation = 0;
    let stops = [];
    let timer = null;
    const clear = () => {
        generation += 1;
        clearTimeout(timer);
        stops.forEach(({ stop }) => stop());
        stops = [];
    };
    const send = (body) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(body));
    };
    ws.on("message", async (raw) => {
        let message;
        try { message = JSON.parse(String(raw)); } catch { return; }
        if (message?.type === "pause") { clear(); return; }
        if (message?.type !== "watch" && message?.type !== "resume") return;
        clear();
        const epoch = generation;
        const account = String(message.account || "").trim();
        const viewQuery = {
            account,
            audience: message.audience === "all" ? "all" : "mine",
            book: message.book || "",
        };
        let running = false;
        let dirty = false;
        const actor = async () => {
            const current = deps.authenticate ? await deps.authenticate() : user;
            if (!current) throw Object.assign(new Error("Phiên đã hết hạn"), { status: 403 });
            return current;
        };
        const emit = async () => {
            if (epoch !== generation) return;
            dirty = true;
            if (running) return;
            running = true;
            try {
                while (dirty && epoch === generation) {
                    dirty = false;
                    // Serialize reads; a slow previous build must never overwrite a newer view.
                    const view = await load(await actor(), viewQuery, {
                        snapshot: source.readExchangeBook,
                        snapshots: source.readExchangeBooks,
                        priceOf: markOf,
                    });
                    if (epoch === generation) {
                        const allowed = new Set(view.accounts.map((row) => row.username));
                        stops = stops.filter((entry) => {
                            if (allowed.has(entry.name)) return true;
                            entry.stop();
                            return false;
                        });
                        send({ type: "snapshot", ...view });
                    }
                }
            } catch (error) {
                if (epoch === generation) {
                    clear();
                    send({ type: "error", error: "Không xem được vị thế hoặc quyền truy cập đã thay đổi" });
                }
            } finally { running = false; }
        };
        const queue = () => {
            if (epoch !== generation) return;
            clearTimeout(timer);
            timer = setTimeout(emit, 50);
        };
        try {
            const view = await load(await actor(), viewQuery, { snapshot: async () => null });
            if (epoch !== generation) return;
            const names = account ? [account] : view.accounts.map((row) => row.username);
            stops = names.map((name) => ({ name, stop: source.watch(name, queue) }));
            queue();
            // Shared account reconciliation also runs on reconnect/resume. Bound concurrency.
            let index = 0;
            await Promise.all(Array.from({ length: Math.min(4, names.length) }, async () => {
                while (index < names.length && epoch === generation) {
                    const name = names[index++];
                    try { await source.reconcile(name, { maxAgeMs: 5_000 }); }
                    catch (error) { console.error("[positionWs]", error.message); }
                    queue();
                }
            }));
        } catch (error) {
            if (epoch === generation) {
                clear();
                send({ type: "error", error: error.status === 403 ? "Không có quyền với tài khoản này" : "Không xem được vị thế" });
            }
        }
    });
    ws.on("close", clear);
}

module.exports = { attachPositionSocket, readCookie, openSocket };
