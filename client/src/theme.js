export const THEME_STORAGE_KEY = "web-bot-theme";

/** Skin packs — id khớp `[data-theme]` trong styles.css */
export const THEMES = [
  {
    id: "gold",
    label: "Vàng tối",
    hint: "Fintech tối, accent amber — mặc định",
  },
  {
    id: "ocean",
    label: "Đại dương",
    hint: "Slate + cyan, hiện đại dễ đọc",
  },
  {
    id: "oled",
    label: "OLED",
    hint: "Nền đen sâu, xanh mint — buổi tối",
  },
  {
    id: "day",
    label: "Ban ngày",
    hint: "Nền sáng, tương phản cao",
  },
];

const THEME_IDS = new Set(THEMES.map((theme) => theme.id));
export const DEFAULT_THEME = "gold";

export function normalizeThemeId(value) {
  return THEME_IDS.has(value) ? value : DEFAULT_THEME;
}

export function applyThemeToDocument(themeId) {
  const id = normalizeThemeId(themeId);
  const root = document.documentElement;
  root.setAttribute("data-theme", id);
  root.style.colorScheme = id === "day" ? "light" : "dark";
  return id;
}

export function readStoredTheme() {
  try {
    return normalizeThemeId(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME;
  }
}

/** Đọc màu đã resolve từ token CSS (lightweight-charts không hiểu var()). */
export function readCssColor(varName, fallback) {
  if (typeof window === "undefined" || typeof getComputedStyle !== "function") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return raw || fallback;
}
