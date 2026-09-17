export type Theme = "light" | "dark";

const THEME_KEY = "boomrang.theme";

export function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "light";
  try {
    return window.localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    return;
  }
}

export const THEME_BOOT_SCRIPT = `(function(){try{var d=document.documentElement;var t=localStorage.getItem("${THEME_KEY}");if(t==="dark"){d.classList.add("dark");d.style.colorScheme="dark";}var l=localStorage.getItem("boomrang.language");if(l==="en"){d.lang="en";d.dir="ltr";}}catch(e){}})();`;
