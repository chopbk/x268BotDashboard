/**
 * News collector — RSS allowlist, dedupe by canonical URL, không scrape full article.
 */
const { config } = require("../config");
const { NEWS_SOURCES, mapAssetsFromTitle } = require("../news-sources");
const { fetchRss, parseRssXml } = require("../providers/rss");
const MarketEconomyNews = require("../../../models/market-economy-news");
const { getContextSnapshot, saveContextSnapshot } = require("../store");

const TTL_MS = 30 * 24 * 3600_000;

async function collectNews() {
    if (!config.newsEnabled) {
        return { ok: false, skipped: true, reason: "news_disabled" };
    }
    const attemptAt = new Date();
    const errors = [];
    let upserted = 0;

    for (const source of NEWS_SOURCES) {
        try {
            const xml = await fetchRss(source.url, config.providerTimeoutMs);
            const items = parseRssXml(xml, { publisher: source.publisher });
            for (const item of items) {
                const assetIds = mapAssetsFromTitle(item.title);
                const expiresAt = new Date(attemptAt.getTime() + TTL_MS);
                const res = await MarketEconomyNews.updateOne(
                    { canonicalUrlHash: item.canonicalUrlHash },
                    {
                        $setOnInsert: {
                            canonicalUrlHash: item.canonicalUrlHash,
                            title: item.title,
                            publisher: item.publisher || source.publisher,
                            sourceId: source.id,
                            canonicalUrl: item.link,
                            publishedAt: item.publishedAt ? new Date(item.publishedAt) : null,
                            collectedAt: attemptAt,
                            topic: source.topic,
                            locale: source.locale,
                            assetIds,
                            expiresAt,
                        },
                    },
                    { upsert: true }
                );
                if (res.upsertedCount) upserted += 1;
            }
        } catch (error) {
            errors.push(`${source.id}:${error.message || error}`);
            console.warn("[MARKET_ECONOMY] news", source.id, error.message || error);
        }
    }

    const snap = (await getContextSnapshot()) || {};
    snap.sourceHealth = {
        ...(snap.sourceHealth || {}),
        news: {
            ok: errors.length < NEWS_SOURCES.length,
            errors,
            upserted,
            at: attemptAt.toISOString(),
        },
    };
    await saveContextSnapshot(snap);

    return {
        ok: errors.length < NEWS_SOURCES.length,
        upserted,
        errors,
        updatedAt: attemptAt.toISOString(),
    };
}

module.exports = { collectNews };
