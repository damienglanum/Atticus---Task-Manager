import type { ThemePreference } from "@/lib/bindings/ThemePreference";

/**
 * Theme resolution.
 *
 * The document always carries an explicit `light` or `dark` class — "system" is
 * resolved here rather than left to CSS, because Radix's colour scales and our
 * own token overrides both key off that class. Leaving it implicit would mean
 * two mechanisms deciding the same thing.
 *
 * The user's *preference* (which may be "system") is persisted in SQLite; the
 * *resolved* theme is derived, never stored.
 */
export type ResolvedTheme = "light" | "dark";

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function resolveSystemTheme(): ResolvedTheme {
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === "system" ? resolveSystemTheme() : preference;
}

export function applyTheme(theme: ResolvedTheme): void {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(theme);
  root.style.colorScheme = theme;
}

/**
 * Applies `preference` now and, when it is "system", keeps following the OS.
 * Returns an unsubscribe so switching away from "system" stops listening.
 */
export function applyThemePreference(preference: ThemePreference): () => void {
  applyTheme(resolveTheme(preference));

  if (preference !== "system") {
    return () => undefined;
  }

  const query = window.matchMedia(DARK_QUERY);
  const update = () => {
    applyTheme(query.matches ? "dark" : "light");
  };

  query.addEventListener("change", update);
  return () => {
    query.removeEventListener("change", update);
  };
}
