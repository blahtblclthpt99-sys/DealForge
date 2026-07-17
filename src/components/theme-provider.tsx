"use client";

import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";

type Theme = "light" | "dark";

const ThemeContext = createContext<{
  theme: Theme;
  toggle: () => void;
}>({ theme: "light", toggle: () => undefined });

function getThemeSnapshot(): Theme {
  if (typeof window === "undefined") return "light";
  const stored = localStorage.getItem("dealforge-theme") as Theme | null;
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getServerSnapshot(): Theme {
  return "light";
}

function subscribe(onStoreChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === "dealforge-theme") onStoreChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener("dealforge-theme", onStoreChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("dealforge-theme", onStoreChange);
  };
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(subscribe, getThemeSnapshot, getServerSnapshot);

  const toggle = useCallback(() => {
    const next: Theme = getThemeSnapshot() === "light" ? "dark" : "light";
    localStorage.setItem("dealforge-theme", next);
    document.documentElement.classList.toggle("dark", next === "dark");
    window.dispatchEvent(new Event("dealforge-theme"));
  }, []);

  if (typeof document !== "undefined") {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }

  return (
    <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
