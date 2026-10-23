/**
 * Config Market Dashboard MVP — docs/market.md
 */
function envBool(name, fallback) {
    const v = process.env[name];
    if (v == null || v === "") return fallback;
    return ["1", "true", "yes", "on"].includes(String(v).toLowerCase());
}

function envInt(name, fallback) {
    const n = Number.parseInt(process.env[name], 10);
    return Number.isFinite(n) ? n : fallback;
}

function envNum(name, fallback) {
    const n = Number(process.env[name]);
    return Number.isFinite(n) ? n : fallback;
}

const SCAN_TFS = Object.freeze(["1h", "4h", "1d"]);
const INTERVAL_MS = Object.freeze({
    "15m": 15 * 60_000,
    "1h": 60 * 60_000,
    "4h": 4 * 60 * 60_000,
    "1d": 24 * 60 * 60_000,
});

const config = Object.freeze({
    enabled: envBool("MARKET_DASH_ENABLED", true),
    topN: envInt("MARKET_DASH_TOP_N", 100),
    maxSymbols: envInt("MARKET_DASH_MAX_SYMBOLS", 150),
    minQuoteVolumeUsd: envNum("MARKET_DASH_MIN_QUOTE_VOL", 20_000_000),
    minListingDays: envInt("MARKET_DASH_MIN_LISTING_DAYS", 30),
    universeRefreshMs: envInt("MARKET_DASH_UNIVERSE_MS", 5 * 60_000),
    tickerPollMs: envInt("MARKET_DASH_TICKER_MS", 2_000),
    derivativesPollMs: envInt("MARKET_DASH_DERIV_MS", 45_000),
    macroPollMs: envInt("MARKET_DASH_MACRO_MS", 5 * 60_000),
    analyzePollMs: envInt("MARKET_DASH_ANALYZE_MS", 60_000),
    leaseMs: envInt("MARKET_DASH_LEASE_MS", 90_000),
    histRetentionDays: envInt("MARKET_DASH_HIST_DAYS", 90),
    candleLimit: envInt("MARKET_DASH_CANDLE_LIMIT", 200),
    alertScoreThreshold: envNum("MARKET_DASH_ALERT_SCORE", 70),
    alertCooldownMs: envInt("MARKET_DASH_ALERT_COOLDOWN_MS", 4 * 60 * 60_000),
    telegramBotToken: process.env.MARKET_DASH_TELEGRAM_BOT_TOKEN || "",
    telegramChatId: process.env.MARKET_DASH_TELEGRAM_CHAT_ID || "",
    telegramDryRun: envBool("MARKET_DASH_TELEGRAM_DRY_RUN", false),
    useWs: envBool("MARKET_DASH_USE_WS", true),
});

module.exports = {
    config,
    SCAN_TFS,
    INTERVAL_MS,
    FORMULA_VERSION: "mdash-v1",
    SCHEMA_VERSION: 1,
};
