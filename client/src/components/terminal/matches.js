/** Client filter — mirror PositionsPage / server filterRows. */
export function matches(row, params) {
  const symbol = (params.get("symbol") || "").trim().toUpperCase();
  const signal = (params.get("signal") || "").trim().toUpperCase();
  const side = (params.get("side") || "").trim().toUpperCase();
  const book = (params.get("book") || "").trim().toLowerCase();
  const env = (params.get("env") || "").trim();
  const exchange = (params.get("exchange") || "").trim().toLowerCase();
  if (symbol
    && !String(row.symbol || "").toUpperCase().includes(symbol)
    && !String(row.instrumentId || "").toUpperCase().includes(symbol)) return false;
  if (exchange && String(row.exchange || "").toLowerCase() !== exchange) return false;
  if (signal && !(row.monitors || []).some((monitor) => `${monitor.signal || ""} ${monitor.type || ""}`.toUpperCase().includes(signal))) return false;
  if (side && row.side !== side) return false;
  if (book === "all") {
    if (row.book === "pending") return false;
  } else if (book === "notpsl") {
    if (!row.notpsl && !(row.monitors || []).some((monitor) => monitor.notpsl)) return false;
  } else if (book === "paper" || book === "pending") {
    if (row.book !== book) return false;
  } else if (book === "live" || book === "") {
    if (row.book === "paper" || row.book === "pending") return false;
  }
  if (env && !(row.monitors || []).some((monitor) => monitor.env === env)) return false;
  if (params.get("warn") === "1" && !(row.warnings || []).length) return false;
  return true;
}

/** Adapter: URL book=live → API không gửi book (contract hiện có = live). */
export function bookForApi(bookParam) {
  const book = (bookParam || "").trim().toLowerCase();
  if (!book || book === "live") return "";
  return book;
}

export const TERMINAL_TABS = ["positions", "open-orders", "position-history", "order-history"];

export function resolveDefaultTab({ canPositions, canOrders, canHistory }) {
  if (canPositions) return "positions";
  if (canOrders) return "open-orders";
  if (canHistory) return "position-history";
  return "positions";
}

export function normalizeTab(tabParam, perms) {
  const tab = TERMINAL_TABS.includes(tabParam) ? tabParam : resolveDefaultTab(perms);
  if (tab === "positions" && !perms.canPositions) return resolveDefaultTab(perms);
  if ((tab === "open-orders" || tab === "order-history") && !perms.canOrders) return resolveDefaultTab(perms);
  if (tab === "position-history" && !perms.canHistory) return resolveDefaultTab(perms);
  return tab;
}
