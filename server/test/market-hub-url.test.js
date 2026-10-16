const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { pathToFileURL } = require("url");

async function loadHub() {
  const file = path.join(__dirname, "../../client/src/lib/market-hub.js");
  return import(pathToFileURL(file).href);
}

test("legacy smart-money redirect mapping", async () => {
  const {
    buildSmartMoneyRedirectPath,
    legacySmartMoneyTabToFlowTab,
  } = await loadHub();
  assert.equal(legacySmartMoneyTabToFlowTab("market"), "overview");
  assert.equal(legacySmartMoneyTabToFlowTab("notable"), "notable");
  assert.equal(legacySmartMoneyTabToFlowTab("watchlist"), "watchlist");
  assert.equal(legacySmartMoneyTabToFlowTab(null), "overview");

  assert.equal(
    buildSmartMoneyRedirectPath("?tab=notable&symbol=BTCUSDT"),
    "/market?tab=flow&flowTab=notable&symbol=BTCUSDT"
  );
  assert.equal(
    buildSmartMoneyRedirectPath("?tab=watchlist&top=20&symbol=ETHUSDT"),
    "/market?tab=flow&flowTab=watchlist&top=20&symbol=ETHUSDT"
  );
  assert.equal(buildSmartMoneyRedirectPath(""), "/market?tab=flow&flowTab=overview");
  assert.equal(
    buildSmartMoneyRedirectPath("?flowTab=watchlist&tab=market"),
    "/market?tab=flow&flowTab=overview"
  );
  assert.equal(
    buildSmartMoneyRedirectPath("?symbol=BTCUSDT", "#panel"),
    "/market?tab=flow&flowTab=overview&symbol=BTCUSDT#panel"
  );
});

test("normalizeMarketHubSearch quyền và tab mặc định", async () => {
  const { normalizeMarketHubSearch, marketHubAccess } = await loadHub();

  const both = marketHubAccess({
    permissions: ["positions.view", "market.view", "smart_money.view"],
  });
  assert.equal(both.canTechnical, true);
  assert.equal(both.canFlow, true);
  assert.equal(both.defaultMainTab, "technical");

  const onlySm = marketHubAccess({ permissions: ["smart_money.view"] });
  assert.equal(onlySm.canTechnical, false);
  assert.equal(onlySm.canFlow, true);
  assert.equal(onlySm.defaultMainTab, "flow");

  const onlyMarket = marketHubAccess({ permissions: ["market.view"] });
  assert.equal(onlyMarket.canTechnical, true);
  assert.equal(onlyMarket.canFlow, false);

  const n1 = normalizeMarketHubSearch("", both);
  assert.equal(n1.mainTab, "technical");
  assert.equal(n1.flowTab, "overview");
  assert.equal(n1.replaced, true);

  const n2 = normalizeMarketHubSearch("?tab=flow&symbol=BTCUSDT", onlySm);
  assert.equal(n2.mainTab, "flow");
  assert.equal(n2.notice, null);

  const n3 = normalizeMarketHubSearch("?tab=technical&symbol=BTCUSDT", onlySm);
  assert.equal(n3.mainTab, "flow");
  assert.ok(n3.notice);
  assert.equal(n3.params.get("symbol"), "BTCUSDT");

  const n4 = normalizeMarketHubSearch("?tab=flow&flowTab=nope", both);
  assert.equal(n4.flowTab, "overview");
  assert.equal(n4.replaced, true);
});

test("resolveFlowTabFromParams ưu tiên flowTab", async () => {
  const { resolveFlowTabFromParams } = await loadHub();
  const p = new URLSearchParams("tab=flow&flowTab=watchlist");
  assert.equal(resolveFlowTabFromParams(p), "watchlist");
  const legacy = new URLSearchParams("tab=notable");
  assert.equal(resolveFlowTabFromParams(legacy), "notable");
});
