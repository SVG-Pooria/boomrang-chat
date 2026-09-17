import { en } from "@/lib/locales/en";

export type Language = "fa" | "en";

export type Vars = Record<string, string | number>;

const LANGUAGE_KEY = "boomrang.language";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

let activeLanguage: Language = "fa";

export function readStoredLanguage(): Language {
  if (typeof window === "undefined") return "fa";
  try {
    return window.localStorage.getItem(LANGUAGE_KEY) === "en" ? "en" : "fa";
  } catch {
    return "fa";
  }
}

export function directionOf(language: Language) {
  return language === "fa" ? "rtl" : "ltr";
}

export function applyLanguage(language: Language) {
  activeLanguage = language;
  if (typeof document === "undefined") return;
  document.documentElement.lang = language;
  document.documentElement.dir = directionOf(language);
  try {
    window.localStorage.setItem(LANGUAGE_KEY, language);
  } catch {
    return;
  }
}

function fill(template: string, vars?: Vars) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}

export function localizeDigits(value: number | string, language: Language = activeLanguage) {
  const text = String(value);
  if (language === "fa") return text.replace(/\d/g, (digit) => PERSIAN_DIGITS[Number(digit)]!);
  return text.replace(/[۰-۹]/g, (digit) => String(PERSIAN_DIGITS.indexOf(digit)));
}

const LEADING_COUNT = /^([+-]?[\d۰-۹][\d۰-۹,٬.٪+]*)\s+(.*)$/;

function translateCounted(text: string) {
  const match = LEADING_COUNT.exec(text);
  if (!match) return null;
  const template = en[`{count} ${match[2]}`];
  return template ? fill(template, { count: match[1]! }) : null;
}

export function translate(text: string, vars?: Vars, language: Language = activeLanguage) {
  if (language === "fa") return fill(text, vars);
  const mapped = en[text] ?? translateCounted(text) ?? text;
  return localizeDigits(fill(mapped, vars), language);
}

export function currentLanguage() {
  return activeLanguage;
}

const CALENDAR_LOCALE: Record<Language, string> = {
  fa: "fa-IR-u-ca-persian",
  en: "en-GB",
};

export function formatClock(iso: string | Date, language: Language = activeLanguage) {
  const date = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(CALENDAR_LOCALE[language], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatDay(
  iso: string | Date,
  options: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", year: "numeric" },
  language: Language = activeLanguage,
) {
  const date = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(CALENDAR_LOCALE[language], options).format(date);
}
