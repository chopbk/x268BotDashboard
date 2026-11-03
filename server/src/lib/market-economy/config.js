/**
 * Config Market Economy (crypto-macro P0) — docs/crypto-macro-intelligence-spec.md
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

const config = Object.freeze({
    /** Bật mặc định sau P0 spike; tắt bằng MARKET_ECONOMY_ENABLED=false. */
    enabled: envBool("MARKET_ECONOMY_ENABLED", true),
    /** Tin RSS allowlist (Google News VI/EN) — tắt bằng MARKET_ECONOMY_NEWS_ENABLED=false. */
    newsEnabled: envBool("MARKET_ECONOMY_NEWS_ENABLED", true),
    reactionEnabled: envBool("MARKET_ECONOMY_REACTION_ENABLED", false),
    remindersEnabled: envBool("MARKET_ECONOMY_REMINDERS_ENABLED", false),
    yieldsPollMs: envInt("MARKET_ECONOMY_YIELDS_MS", 60 * 60_000),
    calendarPollMs: envInt("MARKET_ECONOMY_CALENDAR_MS", 15 * 60_000),
    newsPollMs: envInt("MARKET_ECONOMY_NEWS_MS", 5 * 60_000),
    leaseMs: envInt("MARKET_ECONOMY_LEASE_MS", 90_000),
    providerTimeoutMs: envInt("MARKET_ECONOMY_PROVIDER_TIMEOUT_MS", 12_000),
    providerConcurrency: envInt("MARKET_ECONOMY_PROVIDER_CONCURRENCY", 3),
    fredApiKey: process.env.FRED_API_KEY || "",
    /** Public CSV download (graph) — attribution required; operator must accept FRED terms. */
    fredCsvBase: "https://fred.stlouisfed.org/graph/fredgraph.csv",
    fredApiBase: "https://api.stlouisfed.org/fred/series/observations",
    calendarFeedUrl:
        process.env.MARKET_ECONOMY_CALENDAR_URL ||
        "https://nfs.faireconomy.media/ff_calendar_thisweek.json",
    calendarSource: "faireconomy_ff_thisweek",
    defaultTz: "Asia/Ho_Chi_Minh",
    histRetentionMonths: envInt("MARKET_ECONOMY_RETENTION_MONTHS", 24),
});

module.exports = {
    config,
    FORMULA_VERSION: "economy-context-v1",
    SCHEMA_VERSION: 1,
};
