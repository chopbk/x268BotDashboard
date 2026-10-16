/**
 * Hub Thị trường P0 — URL + quyền (pure, testable).
 * Spec: docs/market-hub-spec.md
 */

export const MAIN_TABS = Object.freeze(["technical", "flow"]);
export const FLOW_TABS = Object.freeze(["overview", "notable", "watchlist"]);

export const PERMS = Object.freeze({
  MARKET_VIEW: "market.view",
  SMART_MONEY_VIEW: "smart_money.view",
  POSITIONS_VIEW: "positions.view",
  ORDERS_VIEW: "orders.view",
  STATISTICS_VIEW: "statistics.view",
});

export function hasPermission(user, permission) {
  return (user?.permissions || []).includes(permission);
}

export function marketHubAccess(user) {
  const canTerminal =
    hasPermission(user, PERMS.POSITIONS_VIEW) ||
    hasPermission(user, PERMS.ORDERS_VIEW) ||
    hasPermission(user, PERMS.STATISTICS_VIEW);
  const canTechnical = hasPermission(user, PERMS.MARKET_VIEW) || canTerminal;
  const canFlow = hasPermission(user, PERMS.SMART_MONEY_VIEW) || canTerminal;
  return {
    canTerminal,
    canTechnical,
    canFlow,
    canMarketHub: canTechnical || canFlow,
    defaultMainTab: canTechnical ? "technical" : "flow",
  };
}

/** Map legacy Smart Money `tab` → flowTab. */
export function legacySmartMoneyTabToFlowTab(legacyTab) {
  if (legacyTab === "notable") return "notable";
  if (legacyTab === "watchlist") return "watchlist";
  return "overview";
}

/**
 * Redirect /smart-money?* → /market?tab=flow&flowTab=…
 * Legacy `tab` ghi đè flowTab nếu xung đột.
 */
export function buildSmartMoneyRedirectSearch(search = "", hash = "") {
  const incoming = new URLSearchParams(typeof search === "string" ? search : "");
  const legacyTab = incoming.get("tab");
  const flowTab = legacySmartMoneyTabToFlowTab(legacyTab);
  // Rebuild: tab + flowTab trước, rồi filter còn lại (ổn định thứ tự, legacy tab ghi đè flowTab).
  const params = new URLSearchParams();
  params.set("tab", "flow");
  params.set("flowTab", flowTab);
  for (const [k, v] of incoming.entries()) {
    if (k === "tab" || k === "flowTab") continue;
    params.append(k, v);
  }
  const qs = params.toString();
  const h = hash && String(hash).startsWith("#") ? hash : hash ? `#${hash}` : "";
  return qs ? `?${qs}${h}` : h || "";
}

export function buildSmartMoneyRedirectPath(search = "", hash = "") {
  return `/market${buildSmartMoneyRedirectSearch(search, hash)}`;
}

/**
 * Chuẩn hóa query hub theo quyền.
 * @returns {{ params: URLSearchParams, replaced: boolean, notice: string|null, mainTab: string, flowTab: string }}
 */
export function normalizeMarketHubSearch(search, access) {
  const params = new URLSearchParams(typeof search === "string" ? search : "");
  let replaced = false;
  let notice = null;

  let mainTab = params.get("tab");
  if (!MAIN_TABS.includes(mainTab)) {
    mainTab = access.defaultMainTab;
    params.set("tab", mainTab);
    replaced = true;
  }

  if (mainTab === "technical" && !access.canTechnical && access.canFlow) {
    mainTab = "flow";
    params.set("tab", "flow");
    replaced = true;
    notice = "Bạn không có quyền xem tab đã chọn";
  } else if (mainTab === "flow" && !access.canFlow && access.canTechnical) {
    mainTab = "technical";
    params.set("tab", "technical");
    replaced = true;
    notice = "Bạn không có quyền xem tab đã chọn";
  }

  let flowTab = params.get("flowTab");
  if (!FLOW_TABS.includes(flowTab)) {
    flowTab = "overview";
    params.set("flowTab", flowTab);
    replaced = true;
  }

  return {
    params,
    replaced,
    notice,
    mainTab,
    flowTab,
  };
}

export function resolveFlowTabFromParams(params) {
  const flowTab = params.get("flowTab");
  if (FLOW_TABS.includes(flowTab)) return flowTab;
  const legacy = params.get("tab");
  if (legacy === "notable" || legacy === "watchlist" || legacy === "market") {
    return legacySmartMoneyTabToFlowTab(legacy);
  }
  return "overview";
}
