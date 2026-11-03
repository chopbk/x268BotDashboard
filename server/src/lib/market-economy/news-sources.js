/**
 * RSS allowlist cố định — không nhận URL từ client (chống SSRF).
 * Ưu tiên nguồn hữu ích cho user VN: Google News tiếng Việt + vài nguồn macro/crypto EN.
 */
const NEWS_SOURCES = Object.freeze([
    {
        id: "gn_vi_crypto",
        publisher: "Google News (VI · crypto)",
        topic: "crypto",
        locale: "vi",
        url:
            "https://news.google.com/rss/search?q=bitcoin+OR+ethereum+OR+crypto+OR+BTC&hl=vi&gl=VN&ceid=VN:vi",
    },
    {
        id: "gn_vi_macro",
        publisher: "Google News (VI · vĩ mô)",
        topic: "macro",
        locale: "vi",
        url:
            "https://news.google.com/rss/search?q=Fed+OR+FOMC+OR+CPI+OR+%22l%C3%A3i+su%E1%BA%A5t%22+OR+l%E1%BA%A1m+ph%C3%A1t&hl=vi&gl=VN&ceid=VN:vi",
    },
    {
        id: "gn_en_crypto",
        publisher: "Google News (EN · crypto)",
        topic: "crypto",
        locale: "en",
        url:
            "https://news.google.com/rss/search?q=bitcoin+OR+ethereum+when:1d&hl=en-US&gl=US&ceid=US:en",
    },
]);

const ASSET_RULES = Object.freeze([
    { assetId: "BTCUSDT", patterns: [/\bbtc\b/i, /\bbitcoin\b/i, /bitcoin/i] },
    { assetId: "ETHUSDT", patterns: [/\beth\b/i, /\bethereum\b/i, /ethereum/i] },
]);

function mapAssetsFromTitle(title) {
    const hits = [];
    for (const rule of ASSET_RULES) {
        if (rule.patterns.some((p) => p.test(title))) hits.push(rule.assetId);
    }
    // Avoid ONE/NEAR style false positives — only explicit allowlist patterns above.
    return hits;
}

function getSourceById(id) {
    return NEWS_SOURCES.find((s) => s.id === id) || null;
}

module.exports = {
    NEWS_SOURCES,
    mapAssetsFromTitle,
    getSourceById,
};
