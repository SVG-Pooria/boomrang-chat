import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { readSession, request } from "@/lib/auth";
import { applyTheme, readStoredTheme, type Theme } from "@/lib/theme-core";

type ThemeValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (!readSession()) return;
    request<{ theme?: Theme }>("/preferences/me")
      .then((preferences) => {
        if (preferences.theme === "dark" || preferences.theme === "light") {
          setThemeState(preferences.theme);
        }
      })
      .catch(() => undefined);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    if (!readSession()) return;
    request("/preferences/me", { method: "PATCH", body: JSON.stringify({ theme: next }) }).catch(
      () => undefined,
    );
  }, []);

  const value = useMemo<ThemeValue>(
    () => ({
      theme,
      setTheme,
      toggleTheme: () => setTheme(theme === "dark" ? "light" : "dark"),
    }),
    [theme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}
