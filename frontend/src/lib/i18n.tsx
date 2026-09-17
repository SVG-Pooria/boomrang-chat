import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  applyLanguage,
  directionOf,
  formatClock,
  formatDay,
  localizeDigits,
  readStoredLanguage,
  translate,
  type Language,
  type Vars,
} from "@/lib/i18n-core";

type I18nValue = {
  language: Language;
  dir: "rtl" | "ltr";
  t: (text: string, vars?: Vars) => string;
  digits: (value: number | string) => string;
  clock: (iso: string | Date) => string;
  day: (iso: string | Date, options?: Intl.DateTimeFormatOptions) => string;
  setLanguage: (language: Language) => void;
  refresh: () => Promise<void>;
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(readStoredLanguage);

  const setLanguage = useCallback((next: Language) => {
    applyLanguage(next);
    setLanguageState(next);
  }, []);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/settings/public");
    if (!response.ok) return;
    const payload = (await response.json()) as { language?: string };
    setLanguage(payload.language === "en" ? "en" : "fa");
  }, [setLanguage]);

  useEffect(() => {
    applyLanguage(language);
  }, [language]);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  const value = useMemo<I18nValue>(
    () => ({
      language,
      dir: directionOf(language),
      t: (text, vars) => translate(text, vars, language),
      digits: (input) => localizeDigits(input, language),
      clock: (iso) => formatClock(iso, language),
      day: (iso, options) => formatDay(iso, options, language),
      setLanguage,
      refresh,
    }),
    [language, setLanguage, refresh],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider");
  return context;
}
