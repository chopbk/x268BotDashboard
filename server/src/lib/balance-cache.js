const { getRedisClient } = require("./rate-limit-store");

const BAL_PREFIX = "wb:bal:";
const FRESH_MS = 45 * 60 * 1000;

function num(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function balanceKey(env) {
    return `${BAL_PREFIX}${String(env || "").trim().toUpperCase()}`;
}

/**
 * Đọc availableBalance + wallet/total do binance-bot ghi Redis.
 * @returns {Promise<{ available: number|null, balance: number|null, at: string|null, stale: boolean, source: string }|null>}
 */
async function readEnvBalance(env) {
    const key = balanceKey(env);
    if (!key.endsWith(String(env || "").trim().toUpperCase()) || key === BAL_PREFIX) return null;
    const client = getRedisClient();
    if (!client?.isReady) return null;
    try {
        const raw = await client.get(key);
        if (!raw) return null;
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        const at = parsed?.at || null;
        const age = at ? Date.now() - new Date(at).getTime() : null;
        const stale = age == null || age < 0 || age > FRESH_MS;
        return {
            env: String(parsed?.env || env).toUpperCase(),
            available: num(parsed?.available),
            balance: num(parsed?.balance),
            at,
            stale,
            source: "redis",
        };
    } catch (error) {
        console.warn("[readEnvBalance]", env, error.message);
        return null;
    }
}

module.exports = {
    BAL_PREFIX,
    FRESH_MS,
    balanceKey,
    readEnvBalance,
};
