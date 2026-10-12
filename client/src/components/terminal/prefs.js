const VERSION = 3;
const PREFIX = "web-bot.terminal.v1";

export const DEFAULT_COLUMNS = {
  symbol: true,
  account: true,
  volume: true,
  size: false,
  entryMark: true,
  pnl: true,
  recorded: true,
  protection: true,
  actions: true,
  config: false,
  liquidation: false,
  dataAge: false,
};

export const COLUMN_LABELS = {
  symbol: "Symbol",
  account: "Tài khoản",
  volume: "Volume",
  size: "Size (qty)",
  entryMark: "Entry/Mark",
  pnl: "PnL/ROI",
  recorded: "PnL ghi nhận",
  protection: "Bảo vệ",
  actions: "Thao tác",
  config: "Config/Signal",
  liquidation: "Thanh lý",
  dataAge: "Tuổi DL",
};

export const SAVED_VIEWS = [
  { id: "all", name: "Tất cả", filters: {} },
  { id: "profit", name: "Đang lời", filters: { pnl: "up" } },
  { id: "loss", name: "Đang lỗ", filters: { pnl: "down" } },
  { id: "attention", name: "Cần chú ý", filters: { warn: "1" } },
];

function storageKey(userId) {
  return `${PREFIX}:${userId || "anon"}`;
}

export function loadPrefs(userId) {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return defaultPrefs();
    const data = JSON.parse(raw);
    const columns = migrateColumns(data);
    return {
      ...defaultPrefs(),
      ...data,
      version: VERSION,
      columns,
      customViews: Array.isArray(data.customViews) ? data.customViews : [],
      panelWidth: clampPanelWidth(data.panelWidth ?? 360),
    };
  } catch {
    return defaultPrefs();
  }
}

function migrateColumns(data) {
  const prev = data?.columns || {};
  // v1: size mặc định bật, notional tắt → v2: volume mặc định
  // v3: bật PnL ghi nhận cạnh PnL/ROI (cùng field `recorded` như /positions)
  if (data?.version !== VERSION) {
    const next = { ...DEFAULT_COLUMNS, ...prev };
    if (prev.notional === true && prev.volume == null) next.volume = true;
    if (prev.size === true && prev.volume == null && data?.version === 1) {
      next.volume = true;
      next.size = false;
    }
    if ((data?.version == null || data?.version <= 2) && prev.recorded !== true) {
      next.recorded = true;
    }
    delete next.notional;
    return next;
  }
  const merged = { ...DEFAULT_COLUMNS, ...prev };
  delete merged.notional;
  return merged;
}

export function savePrefs(userId, prefs) {
  const columns = { ...DEFAULT_COLUMNS, ...(prefs.columns || {}) };
  delete columns.notional;
  const payload = {
    version: VERSION,
    columns,
    density: prefs.density === "compact" ? "compact" : "comfortable",
    panelWidth: clampPanelWidth(prefs.panelWidth),
    panelOpen: prefs.panelOpen !== false,
    notifyOptIn: Boolean(prefs.notifyOptIn),
    customViews: (prefs.customViews || []).slice(0, 20).map((view) => ({
      id: String(view.id),
      name: String(view.name || "View").slice(0, 40),
      filters: view.filters || {},
    })),
  };
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(payload));
  } catch (error) {
    console.error("[terminal-prefs]", error);
  }
  return payload;
}

export function defaultPrefs() {
  return {
    version: VERSION,
    columns: { ...DEFAULT_COLUMNS },
    density: "compact",
    panelWidth: 360,
    panelOpen: true,
    notifyOptIn: false,
    customViews: [],
  };
}

export function clampPanelWidth(width) {
  const n = Number(width);
  if (!Number.isFinite(n)) return 360;
  return Math.min(560, Math.max(360, Math.round(n)));
}

/** Áp view đã lưu lên filter client (pnl up/down) — không đổi quyền. */
export function rowMatchesSavedView(row, viewId, customViews = []) {
  const builtin = SAVED_VIEWS.find((v) => v.id === viewId);
  const view = builtin || customViews.find((v) => v.id === viewId);
  if (!view) return true;
  const filters = view.filters || {};
  if (filters.pnl === "up") {
    const n = Number(row.unrealized);
    if (!(Number.isFinite(n) && n > 0)) return false;
  }
  if (filters.pnl === "down") {
    const n = Number(row.unrealized);
    if (!(Number.isFinite(n) && n < 0)) return false;
  }
  if (filters.symbol && !String(row.symbol || "").toUpperCase().includes(String(filters.symbol).toUpperCase())) return false;
  if (filters.side && row.side !== filters.side) return false;
  if (filters.env && !(row.monitors || []).some((m) => m.env === filters.env)) return false;
  return true;
}
