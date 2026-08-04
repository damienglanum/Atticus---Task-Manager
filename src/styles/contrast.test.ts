// @vitest-environment node
//
// Reads the stylesheets from disk, so `import.meta.url` must be a file: URL —
// under jsdom it is not. See `src/lib/schemas.test.ts` for the same reason.
//
// Milestone 8 requires contrast *measured, not eyeballed*, in both themes. Every
// number below is computed from the values in `tokens.css` and the Radix scales
// it imports, and printed as well as asserted: a threshold that passes at 4.51
// is worth knowing about before it becomes a threshold that fails at 4.49.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { ColorPalette } from "@/lib/bindings/ColorPalette";
import {
  colorOf,
  contrastRatio,
  relativeLuminance,
  resolvePalette,
  tokenContrast,
} from "./palette";
import type { Theme } from "./palette";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

const THEMES: Theme[] = ["light", "dark"];
const CUSTOM_PALETTES = [
  "green-twilight",
  "wisteria-prussian",
  "violet-linen",
  "parchment-coral",
  "custard-pine",
  "laser-gold",
] as const satisfies readonly ColorPalette[];

/** Every surface text is allowed to sit on. */
const SURFACES = [
  "--color-surface-app",
  "--color-surface-column",
  "--color-surface-card",
  "--color-surface-raised",
  "--color-surface-sunken",
] as const;

/** WCAG 2.2 SC 1.4.3 for body text; the app's largest text is 15px, so nothing qualifies as large. */
const TEXT = 4.5;
/** WCAG 2.2 SC 1.4.11 for user-interface components and their focus indicators. */
const NON_TEXT = 3;

function report(rows: [string, number][]): void {
  const width = Math.max(...rows.map(([label]) => label.length));
  for (const [label, ratio] of rows) {
    console.log(`  ${label.padEnd(width)}  ${ratio.toFixed(2)}:1`);
  }
}

describe("the palette resolver", () => {
  it("reads the two themes as different palettes rather than one", () => {
    expect(colorOf("--color-surface-card", "light")).not.toBe(
      colorOf("--color-surface-card", "dark"),
    );
  });

  it("follows a var() chain to a literal, as the cascade does", () => {
    // --color-fg-primary is defined as var(--slate-12), which Radix defines.
    expect(colorOf("--color-fg-primary", "light")).toBe(colorOf("--slate-12", "light"));
  });

  it("ignores the wide-gamut values, which are not what a ratio may be computed from", () => {
    for (const theme of THEMES) {
      for (const [name, value] of resolvePalette(theme)) {
        expect(value, `${name} under ${theme}`).not.toContain("display-p3");
      }
    }
  });

  it("keeps --color-fg-muted out of text a user is meant to read", () => {
    // The token exists only for the disabled and inactive states SC 1.4.3
    // exempts, and it measures 3.33:1 at worst — so nothing else may reach for
    // it. Asserted at the call sites rather than trusted to the comment beside
    // the token, because the comment is what stops being true first.
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const source = readFileSync(file, "utf8");
      for (const [match] of source.matchAll(/[\w:[\]-]*fg-muted/g)) {
        if (!/^(data-)?disabled:/.test(match) && !match.startsWith("data-[disabled")) {
          offenders.push(`${file.slice(SRC.length + 1)}: ${match}`);
        }
      }
    }

    expect(offenders).toStrictEqual([]);
  });

  it("never leaves a control with outline-none and no ring to replace it", () => {
    // The milestone-8 regression, guarded where it can actually be guarded.
    //
    // `outline-none` lives in Tailwind's utilities layer and so beats the
    // `:focus-visible` rule in `@layer base`. Every text field in the app
    // carried it, and focusing one drew nothing at all. The obvious test —
    // focus a field in the real window and read the computed style — turned out
    // not to be reliable under the end-to-end driver (see `docs/testing.md`),
    // and jsdom has no stylesheet at all. So the rule is enforced on the source:
    // if a file suppresses the outline, something in it has to put one back.
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const source = readFileSync(file, "utf8");
      if (!source.includes("outline-none")) continue;

      const restoresIt =
        source.includes("focus-within:outline-") || source.includes("data-highlighted:outline-");
      if (!restoresIt) offenders.push(file.slice(SRC.length + 1));
    }

    expect(offenders).toStrictEqual([]);
  });

  it("computes the two anchor ratios of the WCAG formula", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
  });
});

describe.each(THEMES)("text contrast — %s theme", (theme) => {
  it.each(["--color-fg-primary", "--color-fg-secondary"])(
    "%s reaches 4.5:1 on every surface",
    (foreground) => {
      const rows = SURFACES.map(
        (surface) =>
          [`${foreground} on ${surface}`, tokenContrast(foreground, surface, theme)] as [
            string,
            number,
          ],
      );
      report(rows);

      for (const [label, ratio] of rows) {
        expect(ratio, label).toBeGreaterThanOrEqual(TEXT);
      }
    },
  );

  it.each([
    ["--color-accent-fg", "--color-accent-bg"],
    ["--color-danger-fg", "--color-danger-bg"],
    ["--color-warning-fg", "--color-warning-bg"],
  ])("%s reaches 4.5:1 on %s and on the card it sits on", (foreground, tint) => {
    const rows: [string, number][] = [
      [`${foreground} on ${tint}`, tokenContrast(foreground, tint, theme)],
      ...SURFACES.map(
        (surface) =>
          [`${foreground} on ${surface}`, tokenContrast(foreground, surface, theme)] as [
            string,
            number,
          ],
      ),
    ];
    report(rows);

    for (const [label, ratio] of rows) {
      expect(ratio, label).toBeGreaterThanOrEqual(TEXT);
    }
  });

  it("keeps labels on solid buttons readable", () => {
    const rows: [string, number][] = [
      [
        "--color-on-accent-solid on --color-accent-solid",
        tokenContrast("--color-on-accent-solid", "--color-accent-solid", theme),
      ],
      [
        "--color-on-solid on --color-danger-solid",
        tokenContrast("--color-on-solid", "--color-danger-solid", theme),
      ],
    ];
    report(rows);

    for (const [label, ratio] of rows) {
      expect(ratio, label).toBeGreaterThanOrEqual(TEXT);
    }
  });
});

describe.each(CUSTOM_PALETTES)("custom accent palette — %s", (colorPalette) => {
  describe.each(THEMES)("%s theme", (theme) => {
    it("keeps accent text readable on its tint and every neutral surface", () => {
      const rows: [string, number][] = [
        [
          "--color-accent-fg on --color-accent-bg",
          tokenContrast("--color-accent-fg", "--color-accent-bg", theme, colorPalette),
        ],
        ...SURFACES.map(
          (surface) =>
            [
              `--color-accent-fg on ${surface}`,
              tokenContrast("--color-accent-fg", surface, theme, colorPalette),
            ] as [string, number],
        ),
      ];
      report(rows);

      for (const [label, ratio] of rows) {
        expect(ratio, `${colorPalette}: ${label}`).toBeGreaterThanOrEqual(TEXT);
      }
    });

    it("keeps the label on a solid accent readable", () => {
      const ratio = tokenContrast(
        "--color-on-accent-solid",
        "--color-accent-solid",
        theme,
        colorPalette,
      );
      report([["accent label on solid", ratio]]);

      expect(ratio).toBeGreaterThanOrEqual(TEXT);
    });

    it("keeps focus and accent boundaries visible", () => {
      const adjacent = ["--color-accent-bg", ...SURFACES] as const;
      const rows: [string, number][] = adjacent.flatMap((surface) => [
        [
          `--color-focus-ring on ${surface}`,
          tokenContrast("--color-focus-ring", surface, theme, colorPalette),
        ],
        [
          `--color-accent-border on ${surface}`,
          tokenContrast("--color-accent-border", surface, theme, colorPalette),
        ],
      ]);
      report(rows);

      for (const [label, ratio] of rows) {
        expect(ratio, `${colorPalette}: ${label}`).toBeGreaterThanOrEqual(NON_TEXT);
      }
    });
  });
});

describe("the supplied colour anchors", () => {
  it.each([
    ["green-twilight", "#b9fa3c", "#04045e"],
    ["wisteria-prussian", "#8fa0d8", "#0c0829"],
    ["violet-linen", "#fff3e5", "#371931"],
    ["parchment-coral", "#faf5ef", "#ec5e5a"],
    ["custard-pine", "#ffefb3", "#013e37"],
    ["laser-gold", "#f0ede4", "#070d0d"],
  ] as const)("ships %s with both requested anchors", (colorPalette, light, dark) => {
    const shipped = new Set([
      colorOf("--color-accent-fg", "light", colorPalette),
      colorOf("--color-accent-bg", "light", colorPalette),
      colorOf("--color-accent-solid", "light", colorPalette),
      colorOf("--color-on-accent-solid", "light", colorPalette),
      colorOf("--color-accent-fg", "dark", colorPalette),
      colorOf("--color-accent-bg", "dark", colorPalette),
      colorOf("--color-accent-solid", "dark", colorPalette),
      colorOf("--color-on-accent-solid", "dark", colorPalette),
    ]);

    expect(shipped).toContain(light);
    expect(shipped).toContain(dark);
  });
});

describe.each(THEMES)("non-text contrast — %s theme", (theme) => {
  it("shows the focus ring against every surface it can appear over", () => {
    // SC 1.4.11: the indicator must be distinguishable from the *adjacent*
    // colour. The ring is drawn with an offset, so both neighbours are surfaces
    // rather than the control's own fill.
    const rows = SURFACES.map(
      (surface) =>
        [
          `--color-focus-ring on ${surface}`,
          tokenContrast("--color-focus-ring", surface, theme),
        ] as [string, number],
    );
    report(rows);

    for (const [label, ratio] of rows) {
      expect(ratio, label).toBeGreaterThanOrEqual(NON_TEXT);
    }
  });

  it("keeps the focus ring distinguishable from the selected state", () => {
    // Focus and selection must not read as the same thing (product-spec §10).
    // Selection is a background fill; focus is this ring. If they were the same
    // hue at the same step, a selected row would look permanently focused.
    const ratio = tokenContrast("--color-focus-ring", "--color-accent-bg", theme);
    report([["--color-focus-ring on --color-accent-bg", ratio]]);

    expect(ratio).toBeGreaterThanOrEqual(NON_TEXT);
  });

  it("draws a control's boundary at 3:1", () => {
    // `--color-border-strong` is the border of an interactive control. The
    // subtle and default hairlines separate content rather than identify a
    // control, so 1.4.11 does not govern them; they are reported, not asserted.
    const asserted = SURFACES.map(
      (surface) =>
        [
          `--color-border-strong on ${surface}`,
          tokenContrast("--color-border-strong", surface, theme),
        ] as [string, number],
    );
    const reported = (["--color-border-subtle", "--color-border-default"] as const).map(
      (border) =>
        [
          `${border} on --color-surface-card`,
          tokenContrast(border, "--color-surface-card", theme),
        ] as [string, number],
    );
    report([...asserted, ...reported]);

    for (const [label, ratio] of asserted) {
      expect(ratio, label).toBeGreaterThanOrEqual(NON_TEXT);
    }
  });
});
