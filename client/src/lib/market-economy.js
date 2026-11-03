/**
 * URL helpers + nhãn tiếng Việt cho Market Economy.
 */

export const ECON_VIEWS = Object.freeze(["context", "calendar", "news"]);
export const ECON_RANGES = Object.freeze(["today", "week", "7d"]);
export const ECON_IMPACTS = Object.freeze(["high,medium", "high", "all"]);
export const DEFAULT_ECON_TZ = "Asia/Ho_Chi_Minh";

export function normalizeEconView(raw, { newsEnabled = true } = {}) {
  if (raw === "news" && !newsEnabled) {
    return { view: "context", notice: "Tin tức chưa bật — chuyển về Bối cảnh" };
  }
  return { view: ECON_VIEWS.includes(raw) ? raw : "context", notice: null };
}

export function normalizeEconRange(raw) {
  return ECON_RANGES.includes(raw) ? raw : "today";
}

export function normalizeEconImpact(raw) {
  if (!raw) return "high,medium";
  if (raw === "all" || raw === "high" || raw === "medium" || raw === "high,medium") return raw;
  return "high,medium";
}

export function normalizeEconTz(raw) {
  if (!raw || typeof raw !== "string") return DEFAULT_ECON_TZ;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: raw }).format(new Date());
    return raw;
  } catch {
    return DEFAULT_ECON_TZ;
  }
}

export function normalizeEconCurrency(raw) {
  const v = String(raw || "USD").toUpperCase();
  if (["USD", "EUR", "ALL"].includes(v)) return v;
  return "USD";
}

/**
 * @returns {{ replaced: boolean, notice: string|null }}
 */
export function normalizeEconomyParams(params, { newsEnabled = true } = {}) {
  let replaced = false;
  let notice = null;
  const { view, notice: viewNotice } = normalizeEconView(params.get("econView"), { newsEnabled });
  if (params.get("econView") !== view) {
    params.set("econView", view);
    replaced = true;
  }
  if (viewNotice) notice = viewNotice;

  const range = normalizeEconRange(params.get("econRange"));
  if (params.get("econRange") !== range) {
    params.set("econRange", range);
    replaced = true;
  }

  const impact = normalizeEconImpact(params.get("econImpact"));
  if (params.get("econImpact") !== impact) {
    params.set("econImpact", impact);
    replaced = true;
  }

  const currency = normalizeEconCurrency(params.get("econCurrency"));
  if (params.get("econCurrency") !== currency) {
    params.set("econCurrency", currency);
    replaced = true;
  }

  const tz = normalizeEconTz(params.get("econTz"));
  if (params.get("econTz") !== tz) {
    params.set("econTz", tz);
    replaced = true;
  }

  const region = (params.get("region") || "us").toLowerCase();
  if (region !== "us") {
    params.set("region", "us");
    replaced = true;
  } else if (!params.get("region")) {
    params.set("region", "us");
    replaced = true;
  }

  return { replaced, notice };
}

export function formatCountdown(ms) {
  if (ms == null || !Number.isFinite(ms)) return null;
  if (ms <= 0) return "Đến giờ";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 48) return `${Math.floor(h / 24)} ngày`;
  if (h > 0) return `${h} giờ ${String(m).padStart(2, "0")} phút`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatInTz(iso, timeZone = DEFAULT_ECON_TZ, dateOnly = false) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("vi-VN", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      ...(dateOnly ? {} : { hour: "2-digit", minute: "2-digit", hour12: false }),
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

export function statusLabel(status, statusLabelVi) {
  if (statusLabelVi) return statusLabelVi;
  switch (status) {
    case "scheduled":
      return "Sắp tới";
    case "due":
      return "Đến giờ — chờ số liệu";
    case "released":
      return "Đã có số liệu";
    case "postponed":
      return "Hoãn";
    case "cancelled":
      return "Hủy";
    default:
      return "Chưa rõ";
  }
}

export function impactLabel(impact, impactLabelVi) {
  if (impactLabelVi) return impactLabelVi;
  if (impact === "high") return "Cao";
  if (impact === "medium") return "Trung bình";
  if (impact === "low") return "Thấp";
  if (impact === "holiday") return "Nghỉ lễ";
  return "Chưa rõ";
}

export function qualityLabel(quality) {
  switch (quality) {
    case "fresh":
      return "mới";
    case "stale":
      return "cũ / giữ bản trước";
    case "missing":
      return "thiếu";
    case "error":
      return "lỗi nguồn";
    case "warming":
      return "đang thu thập";
    default:
      return quality || "—";
  }
}

export function tzOptionLabel(tz) {
  if (tz === "Asia/Ho_Chi_Minh") return "Giờ Việt Nam (UTC+7)";
  if (tz === "America/New_York") return "Giờ New York";
  if (tz === "UTC") return "UTC";
  return tz;
}
