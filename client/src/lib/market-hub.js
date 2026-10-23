/**
 * Hub Thị trường P0 — URL + quyền (pure, testable).
 * Spec: docs/market-hub-spec.md
 */

export const MAIN_TABS = Object.freeze(["technical", "flow", "dashboard"]);
export const FLOW_TABS = Object.freeze(["overview", "notable", "watchlist"]);
export const VIEW_MODES = Object.freeze(["location", "scores"]);
export const TOP_OPTIONS = Object.freeze([10, 25, 50]);
export const ANALYSIS_TFS = Object.freeze(["15m", "1h", "4h", "1d"]);

/** R1: top=20→25, 30→50; giá trị khác → 10. */
export function normalizeTopParam(raw, fallback = 10) {
  const n = Number.parseInt(raw, 10);
  if (n === 20) return 25;
  if (n === 30) return 50;
  if (TOP_OPTIONS.includes(n)) return n;
  return fallback;
}

export function normalizeViewParam(raw) {
  return VIEW_MODES.includes(raw) ? raw : "location";
}

export function normalizeAnalysisTfParam(raw) {
  return ANALYSIS_TFS.includes(raw) ? raw : "1h";
}

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
    canDashboard: canTechnical,
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
  } else if (mainTab === "dashboard" && !access.canDashboard) {
    mainTab = access.canFlow ? "flow" : access.defaultMainTab;
    params.set("tab", mainTab);
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

  const topRaw = params.get("top");
  const topNorm = normalizeTopParam(topRaw == null || topRaw === "" ? "10" : topRaw, 10);
  if (String(topNorm) !== String(topRaw || "10")) {
    params.set("top", String(topNorm));
    replaced = true;
  } else if (topRaw == null || topRaw === "") {
    params.set("top", "10");
    replaced = true;
  }

  if (mainTab === "technical") {
    const view = normalizeViewParam(params.get("view"));
    if (params.get("view") !== view) {
      params.set("view", view);
      replaced = true;
    }
    const analysisTf = normalizeAnalysisTfParam(params.get("analysisTf"));
    if (params.get("analysisTf") !== analysisTf) {
      params.set("analysisTf", analysisTf);
      replaced = true;
    }
  }

  return {
    params,
    replaced,
    notice,
    mainTab,
    flowTab,
    top: topNorm,
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
