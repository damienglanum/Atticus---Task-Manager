import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyColorPalette,
  applyTheme,
  applyThemePreference,
  resolveSystemTheme,
  resolveTheme,
} from "./theme";

/** jsdom has no real `matchMedia`, so tests drive it explicitly. */
function stubPrefersDark(prefersDark: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: prefersDark,
    addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
  };

  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => query),
  );

  return {
    change(nowPrefersDark: boolean) {
      query.matches = nowPrefersDark;
      for (const listener of listeners) listener();
    },
    listenerCount: () => listeners.size,
  };
}

function themeClass(): string | undefined {
  return [...document.documentElement.classList].find(
    (name) => name === "light" || name === "dark",
  );
}

afterEach(() => {
  document.documentElement.classList.remove("light", "dark");
  document.documentElement.classList.remove(
    "palette-atticus",
    "palette-green-twilight",
    "palette-wisteria-prussian",
    "palette-violet-linen",
    "palette-parchment-coral",
    "palette-custard-pine",
    "palette-laser-gold",
  );
  document.documentElement.style.colorScheme = "";
  vi.unstubAllGlobals();
});

describe("applyColorPalette", () => {
  it("leaves exactly one colour-palette class on the document", () => {
    applyColorPalette("green-twilight");
    applyColorPalette("custard-pine");

    expect(
      [...document.documentElement.classList].filter((name) => name.startsWith("palette-")),
    ).toStrictEqual(["palette-custard-pine"]);
  });

  it("does not disturb the resolved light or dark class", () => {
    applyTheme("dark");
    applyColorPalette("violet-linen");

    expect(themeClass()).toBe("dark");
    expect(document.documentElement).toHaveClass("palette-violet-linen");
  });
});

describe("applyTheme", () => {
  it("leaves exactly one theme class on the document", () => {
    applyTheme("dark");
    applyTheme("light");

    expect(
      [...document.documentElement.classList].filter((c) => c === "light" || c === "dark"),
    ).toStrictEqual(["light"]);
  });

  it("sets color-scheme so native controls and scrollbars match", () => {
    applyTheme("dark");

    expect(document.documentElement.style.colorScheme).toBe("dark");
  });
});

describe("resolveSystemTheme", () => {
  it.each([
    [true, "dark"],
    [false, "light"],
  ])("maps prefers-color-scheme: dark = %s to %s", (prefersDark, expected) => {
    stubPrefersDark(prefersDark);

    expect(resolveSystemTheme()).toBe(expected);
  });
});

describe("resolveTheme", () => {
  it("returns an explicit preference without consulting the system", () => {
    stubPrefersDark(true);

    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
  });

  it("defers to the system only when the preference is 'system'", () => {
    stubPrefersDark(true);

    expect(resolveTheme("system")).toBe("dark");
  });
});

describe("applyThemePreference", () => {
  it("applies an explicit preference immediately", () => {
    stubPrefersDark(true);

    applyThemePreference("light");

    expect(themeClass()).toBe("light");
  });

  it("does not listen to the system when the preference is explicit", () => {
    const media = stubPrefersDark(false);

    applyThemePreference("dark");

    expect(media.listenerCount()).toBe(0);
  });

  it("keeps following the system while the preference is 'system'", () => {
    const media = stubPrefersDark(false);
    applyThemePreference("system");
    expect(themeClass()).toBe("light");

    media.change(true);

    expect(themeClass()).toBe("dark");
  });

  it("stops following the system once unsubscribed", () => {
    const media = stubPrefersDark(false);

    const unsubscribe = applyThemePreference("system");
    expect(media.listenerCount()).toBe(1);
    unsubscribe();

    expect(media.listenerCount()).toBe(0);
  });
});
