/**
 * Cấu hình Smart Money collector — giá trị interval là mặc định ban đầu, có thể giảm tải.
 */
function intEnv(name, fallback) {
    const n = Number(process.env[name]);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function boolEnv(name, fallback = true) {
    const raw = process.env[name];
    if (raw == null || raw === "") return fallback;
    return !/^(0|false|no|off)$/i.test(String(raw).trim());
}

/** CSV symbol cố định — nếu set thì bỏ top-volume, chỉ theo dõi danh sách này. */
function symbolsEnv(name) {
    const raw = String(process.env[name] || "").trim();
    if (!raw) return Object.freeze([]);
    const out = [];
    const seen = new Set();
    for (const part of raw.split(",")) {
        const sym = String(part || "")
            .trim()
            .toUpperCase();
        if (!/^[A-Z0-9]{4,25}$/.test(sym) || seen.has(sym)) continue;
        seen.add(sym);
        out.push(sym);
    }
    return Object.freeze(out);
}

const SCHEMA_VERSION = "sm-v1";
const FORMULA_VERSION = "sm-formula-v1";
const CANDIDATE_VERSION = "sm-candidate-v1";

const forceSymbols = symbolsEnv("SMART_MONEY_SYMBOLS");

const config = Object.freeze({
    enabled: boolEnv("SMART_MONEY_ENABLED", true),
    /** Khi có giá trị: universe = đúng list này (vd BTCUSDT,ETHUSDT). */
    forceSymbols,
    // R1: mặc định theo dõi top 50; UI Top 10/25/50 chỉ cắt hiển thị.
    topN: forceSymbols.length ? forceSymbols.length : intEnv("SMART_MONEY_TOP_N", 50),
    maxSymbols: forceSymbols.length
        ? Math.max(forceSymbols.length, intEnv("SMART_MONEY_MAX_SYMBOLS", 60))
        : intEnv("SMART_MONEY_MAX_SYMBOLS", 60),
    stickyMs: intEnv("SMART_MONEY_STICKY_MS", 2 * 60 * 60 * 1000),
    universeRefreshMs: intEnv("SMART_MONEY_UNIVERSE_MS", 60 * 60 * 1000),
    retentionDays: intEnv("SMART_MONEY_RETENTION_DAYS", 90),
    oiIntervalMs: intEnv("SMART_MONEY_OI_INTERVAL_MS", 5 * 60 * 1000),
    fundingIntervalMs: intEnv("SMART_MONEY_FUNDING_INTERVAL_MS", 10 * 60 * 1000),
    topTraderIntervalMs: intEnv("SMART_MONEY_TOP_TRADER_INTERVAL_MS", 15 * 60 * 1000),
    smartMoneyIntervalMs: intEnv("SMART_MONEY_SM_INTERVAL_MS", 45 * 60 * 1000),
    smartMoneyGapMs: intEnv("SMART_MONEY_SM_GAP_MS", 15_000),
    smartMoneyJitterMs: intEnv("SMART_MONEY_SM_JITTER_MS", 3_000),
    fapiGapMs: intEnv("SMART_MONEY_FAPI_GAP_MS", 400),
    schedulerTickMs: intEnv("SMART_MONEY_SCHEDULER_MS", 30_000),
    leaseMs: intEnv("SMART_MONEY_LEASE_MS", 4 * 60 * 1000),
    lowPriority: boolEnv("SMART_MONEY_LOW_PRIORITY", true),
    historyLimitMax: 500,
    listLimitMax: 100,
    eventLimitMax: 100,
    candidateLimitMax: 50,
    compareWindows: Object.freeze(["1h", "4h", "24h"]),
    minSamplesForZ: 12,
    minAbsDeltaPct: 3,
    zScoreThreshold: 2.5,
    eventCooldownMs: 60 * 60 * 1000,
});

module.exports = {
    SCHEMA_VERSION,
    FORMULA_VERSION,
    CANDIDATE_VERSION,
    config,
};
