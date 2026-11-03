import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  THEMES,
  applyThemeToDocument,
  normalizeThemeId,
  readStoredTheme,
} from "./theme.js";

export {
  THEME_STORAGE_KEY,
  THEMES,
  DEFAULT_THEME,
  normalizeThemeId,
  applyThemeToDocument,
  readStoredTheme,
  readCssColor,
} from "./theme.js";

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    if (typeof document === "undefined") return "gold";
    return normalizeThemeId(document.documentElement.getAttribute("data-theme") || readStoredTheme());
  });

  useEffect(() => {
    applyThemeToDocument(theme);
    try {
      localStorage.setItem("web-bot-theme", theme);
    } catch {
      /* ignore quota / private mode */
    }
  }, [theme]);

  const value = useMemo(
    () => ({
      theme,
      themes: THEMES,
      setTheme: (next) => setThemeState(normalizeThemeId(next)),
    }),
    [theme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme phải nằm trong ThemeProvider");
  return ctx;
}

export function ThemeSwitcher({ className = "" }) {
  const { theme, themes, setTheme } = useTheme();
  return (
    <label className={`theme-switcher ${className}`.trim()}>
      <span className="theme-switcher-label">Giao diện</span>
      <select
        value={theme}
        aria-label="Chọn giao diện"
        onChange={(event) => setTheme(event.target.value)}
      >
        {themes.map((item) => (
          <option key={item.id} value={item.id} title={item.hint}>
            {item.label}
          </option>
        ))}
      </select>
    </label>
  );
}
