const UserAccount = require("../models/user-account");
const { readEnvBalance } = require("./balance-cache");
const { httpError } = require("./http");
const { canAccessBot } = require("../middleware/auth");
const { PERMISSIONS } = require("../auth/access-control");

/**
 * Đọc available/wallet từ Redis wb:bal theo account (username) hoặc env cụ thể.
 */
async function getAccountBalance(actor, { account, env } = {}) {
    const username = String(account || "").trim();
    if (!username) throw httpError(400, "Thiếu account");
    if (!canAccessBot(actor, username, PERMISSIONS.POSITIONS_VIEW) && !canAccessBot(actor, username, PERMISSIONS.ORDERS_VIEW)) {
        throw httpError(403, "Không có quyền với bot này");
    }
    const row = await UserAccount.findOne({ username }).select("username accounts active").lean();
    if (!row || row.active === false) throw httpError(404, "Không tìm thấy account");

    const wantedEnv = String(env || "").trim().toUpperCase();
    const envs = [];
    if (wantedEnv) envs.push(wantedEnv);
    envs.push(username.toUpperCase());
    for (const item of row.accounts || []) {
        const name = String(item || "").trim().toUpperCase();
        if (name && !envs.includes(name)) envs.push(name);
    }

    for (const name of envs) {
        const bal = await readEnvBalance(name);
        if (bal && (bal.available != null || bal.balance != null)) {
            return {
                account: username,
                env: bal.env || name,
                available: bal.available,
                balance: bal.balance,
                at: bal.at,
                stale: bal.stale,
                source: bal.source,
            };
        }
    }
    return {
        account: username,
        env: wantedEnv || username.toUpperCase(),
        available: null,
        balance: null,
        at: null,
        stale: true,
        source: "none",
        message: "Chưa có wb:bal trên Redis cho env của account này",
    };
}

module.exports = { getAccountBalance };
