/**
 * Cấu hình collector Thị trường (top 50 scoring).
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

function symbolsEnv(name) {
    const raw = String(process.env[name] || "").trim();
    if (!raw) return Object.freeze([]);
    const out = [];
    const seen = new Set();
    for (const part of raw.split(",")) {
        const sym = String(part || "").trim().toUpperCase();
        if (!/^[A-Z0-9]{4,25}$/.test(sym) || seen.has(sym)) continue;
        seen.add(sym);
        out.push(sym);
    }
    return Object.freeze(out);
}

const FORMULA_VERSION = "market-v1";
const SCHEMA_VERSION = "market-schema-v1";

const TIMEFRAMES = Object.freeze(["5m", "15m", "1h", "4h", "1d"]);
const INTERVAL_MS = Object.freeze({
    "5m": 5 * 60_000,
    "15m": 15 * 60_000,
    "1h": 60 * 60_000,
    "4h": 4 * 60 * 60_000,
    "1d": 24 * 60 * 60_000,
});

/** Stale = hệ số × interval sau candleCloseTime. */
const STALE_FACTOR = Object.freeze({
    "5m": 3,
    "15m": 3,
    "1h": 2,
    "4h": 2,
    "1d": 1.5,
});

const STYLES = Object.freeze({
    scalp: Object.freeze({ id: "scalp", label: "Ngắn hạn", frames: Object.freeze(["5m", "15m", "1h"]) }),
    intraday: Object.freeze({ id: "intraday", label: "Trong ngày", frames: Object.freeze(["15m", "1h", "4h"]) }),
    swing: Object.freeze({ id: "swing", label: "Swing", frames: Object.freeze(["1h", "4h", "1d"]) }),
});

const STYLE_WEIGHTS = Object.freeze({ small: 0.2, mid: 0.35, large: 0.45 });

const forceSymbols = symbolsEnv("MARKET_SYMBOLS");

const config = Object.freeze({
    enabled: boolEnv("MARKET_ENABLED", true),
    forceSymbols,
    topN: forceSymbols.length ? forceSymbols.length : intEnv("MARKET_TOP_N", 50),
    maxSymbols: forceSymbols.length
        ? Math.max(forceSymbols.length, intEnv("MARKET_MAX_SYMBOLS", 60))
        : intEnv("MARKET_MAX_SYMBOLS", 60),
    universeRefreshMs: intEnv("MARKET_UNIVERSE_MS", 60 * 60 * 1000),
    stickyMs: intEnv("MARKET_STICKY_MS", 2 * 60 * 60 * 1000),
    schedulerTickMs: intEnv("MARKET_SCHEDULER_MS", 30_000),
    leaseMs: intEnv("MARKET_LEASE_MS", 4 * 60 * 1000),
    candleLimit: intEnv("MARKET_CANDLE_LIMIT", 300),
    minClosedBars: intEnv("MARKET_MIN_CLOSED", 250),
    fetchConcurrency: intEnv("MARKET_FETCH_CONCURRENCY", 2),
    historyLimitMax: 200,
    listLimitMax: 100,
    eventLimitMax: 100,
    eventCooldownMs: intEnv("MARKET_EVENT_COOLDOWN_MS", 60 * 60 * 1000),
    retentionDays: intEnv("MARKET_RETENTION_DAYS", 90),
    defaultStyle: "intraday",
});

module.exports = {
    FORMULA_VERSION,
    SCHEMA_VERSION,
    TIMEFRAMES,
    INTERVAL_MS,
    STALE_FACTOR,
    STYLES,
    STYLE_WEIGHTS,
    config,
};
