const test = require("node:test");
const assert = require("node:assert/strict");
const { parseRssXml } = require("../src/lib/market-economy/providers/rss");
const { mapAssetsFromTitle } = require("../src/lib/market-economy/news-sources");
const { eventHintVi, impactLabelVi, statusLabelVi } = require("../src/lib/market-economy/labels-vi");

test("parseRssXml đọc item title/link/pubDate", () => {
  const xml = `<?xml version="1.0"?>
  <rss><channel>
    <item>
      <title><![CDATA[Bitcoin tăng nhẹ]]></title>
      <link>https://example.com/a?x=1#frag</link>
      <pubDate>Mon, 03 Nov 2026 08:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Bad</title>
      <link>javascript:alert(1)</link>
    </item>
  </channel></rss>`;
  const items = parseRssXml(xml, { publisher: "Test" });
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Bitcoin tăng nhẹ");
  assert.equal(items[0].link, "https://example.com/a?x=1");
  assert.ok(items[0].publishedAt);
  assert.equal(items[0].publisher, "Test");
});

test("mapAssetsFromTitle chỉ BTC/ETH rõ ràng", () => {
  assert.deepEqual(mapAssetsFromTitle("Bitcoin ETF flows"), ["BTCUSDT"]);
  assert.deepEqual(mapAssetsFromTitle("Ethereum upgrade"), ["ETHUSDT"]);
  assert.deepEqual(mapAssetsFromTitle("ONE protocol near ATH"), []);
});

test("nhãn tiếng Việt sự kiện", () => {
  assert.equal(impactLabelVi("high"), "Cao");
  assert.equal(statusLabelVi("due"), "Đến giờ — chờ số liệu");
  assert.ok(eventHintVi("US CPI YoY").includes("CPI"));
  assert.equal(eventHintVi("Random widget meeting"), null);
});
