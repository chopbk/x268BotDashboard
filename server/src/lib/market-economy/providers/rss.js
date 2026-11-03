/**
 * Minimal RSS 2.0 / Atom-ish parser — no extra dependency.
 * Chỉ dùng với URL allowlist nội bộ; không nhận URL từ client.
 */
const crypto = require("crypto");

function decodeXmlEntities(s) {
    return String(s || "")
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function stripTags(s) {
    return decodeXmlEntities(String(s || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function tagText(block, tag) {
    const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i");
    const m = block.match(re);
    if (!m) {
        // <link href="..."/> atom
        if (tag === "link") {
            const href = block.match(/<link[^>]+href=["']([^"']+)["']/i);
            return href ? href[1] : null;
        }
        return null;
    }
    return decodeXmlEntities(m[1]).trim();
}

function canonicalizeUrl(url) {
    try {
        const u = new URL(url);
        if (u.protocol !== "http:" && u.protocol !== "https:") return null;
        u.hash = "";
        return u.toString();
    } catch {
        return null;
    }
}

function urlHash(url) {
    return crypto.createHash("sha256").update(url).digest("hex").slice(0, 32);
}

/**
 * @returns {{ title: string, link: string, publishedAt: string|null, publisher: string|null }[]}
 */
function parseRssXml(xml, { publisher = null } = {}) {
    const text = String(xml || "");
    const items = [];
    const blocks = [];
    const itemRe = /<item[\s>]([\s\S]*?)<\/item>/gi;
    const entryRe = /<entry[\s>]([\s\S]*?)<\/entry>/gi;
    let m;
    while ((m = itemRe.exec(text))) blocks.push(m[1]);
    while ((m = entryRe.exec(text))) blocks.push(m[1]);

    for (const block of blocks) {
        const title = stripTags(tagText(block, "title") || "");
        let link = tagText(block, "link") || "";
        link = stripTags(link);
        if (!link) {
            const guid = tagText(block, "guid");
            if (guid && /^https?:/i.test(guid)) link = guid.trim();
        }
        const canonical = canonicalizeUrl(link);
        if (!title || !canonical) continue;
        const pubRaw =
            tagText(block, "pubDate") ||
            tagText(block, "published") ||
            tagText(block, "updated") ||
            null;
        let publishedAt = null;
        if (pubRaw) {
            const d = new Date(pubRaw);
            if (Number.isFinite(d.getTime())) publishedAt = d.toISOString();
        }
        items.push({
            title,
            link: canonical,
            publishedAt,
            publisher,
            canonicalUrlHash: urlHash(canonical),
        });
    }
    return items;
}

async function fetchRss(url, timeoutMs = 12_000) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            signal: ctrl.signal,
            headers: {
                accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
                "user-agent": "web-bot-economy-news/1.0",
            },
        });
        if (!res.ok) {
            const err = new Error(`rss ${res.status}`);
            err.status = res.status;
            err.retryAfter = res.headers.get("retry-after");
            throw err;
        }
        return await res.text();
    } finally {
        clearTimeout(t);
    }
}

module.exports = {
    parseRssXml,
    fetchRss,
    canonicalizeUrl,
    urlHash,
    stripTags,
};
