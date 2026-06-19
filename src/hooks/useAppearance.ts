import { useState, useEffect } from "react";

export type Theme = "light" | "dark";
export type Accent = "indigo" | "teal" | "amber" | "rose";

function getStored<T extends string>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return (v as T) || fallback;
  } catch {
    return fallback;
  }
}

export function useAppearance() {
  const [theme, setTheme] = useState<Theme>(() => getStored<Theme>("pd-theme", "light"));
  const [accent, setAccent] = useState<Accent>(() => getStored<Accent>("pd-accent", "indigo"));

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("pd-theme", theme); } catch {}
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute("data-accent", accent);
    try { localStorage.setItem("pd-accent", accent); } catch {}
  }, [accent]);

  return { theme, setTheme, accent, setAccent };
}
