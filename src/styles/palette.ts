/**
 * Reads the colour values the application actually ships.
 *
 * Product-spec §10 states contrast requirements, and milestone 8 requires them
 * *measured*. A measurement is only worth something if it reads the same values
 * the browser reads, so this resolves `tokens.css` and the Radix scale files it
 * imports, following the same `var()` chain the cascade would follow. A table of
 * hex values copied beside the stylesheet would pass forever after the
 * stylesheet changed, which is the failure mode this exists to avoid.
 *
 * Used only by `contrast.test.ts`; nothing in the running application imports it.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Theme = "light" | "dark";

const STYLES_DIR = dirname(fileURLToPath(import.meta.url));
const NODE_MODULES = resolve(STYLES_DIR, "../../node_modules");

/** Selectors whose declarations apply, per theme. Source order breaks ties, as in the cascade. */
const SELECTORS: Record<Theme, ReadonlySet<string>> = {
  light: new Set([":root", ".light", ".light-theme", "@theme"]),
  dark: new Set([":root", ".light", ".light-theme", "@theme", ".dark", ".dark-theme"]),
};

interface Block {
  readonly selectors: string[];
  readonly declarations: [string, string][];
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * Top-level blocks only. That is not a shortcut — it is what makes this correct
 * for both inputs: Radix's wide-gamut `color(display-p3 …)` values live inside
 * `@supports`/`@media`, and our zeroed motion durations live inside
 * `@media (prefers-reduced-motion)`. Neither is a colour this test may read.
 */
function parseTopLevelBlocks(css: string): Block[] {
  const source = stripComments(css);
  const blocks: Block[] = [];

  let index = 0;
  let prelude = "";

  while (index < source.length) {
    const char = source[index] ?? "";

    if (char === "{") {
      const start = index + 1;
      let depth = 1;
      let cursor = start;
      while (cursor < source.length && depth > 0) {
        if (source[cursor] === "{") depth += 1;
        else if (source[cursor] === "}") depth -= 1;
        cursor += 1;
      }

      const selectors = prelude
        .trim()
        .split(",")
        .map((selector) => selector.trim())
        .filter(Boolean);

      // `@theme` is Tailwind's way of writing `:root`, so its body is ours to
      // read. Every other at-rule is a condition we are deliberately not in.
      const isAtRule = selectors[0]?.startsWith("@") === true;
      if (!isAtRule || selectors[0] === "@theme") {
        blocks.push({
          selectors,
          declarations: parseDeclarations(source.slice(start, cursor - 1)),
        });
      }

      prelude = "";
      index = cursor;
      continue;
    }

    if (char === ";" && prelude.trim().startsWith("@")) {
      // A statement at-rule — `@import`, `@custom-variant`. No body to read.
      prelude = "";
      index += 1;
      continue;
    }

    prelude += char;
    index += 1;
  }

  return blocks;
}

function parseDeclarations(body: string): [string, string][] {
  const declarations: [string, string][] = [];

  for (const statement of body.split(";")) {
    const separator = statement.indexOf(":");
    if (separator === -1) continue;

    const name = statement.slice(0, separator).trim();
    if (!name.startsWith("--")) continue;

    declarations.push([name, statement.slice(separator + 1).trim()]);
  }

  return declarations;
}

/** The stylesheets that make up the palette, in the order the browser loads them. */
function stylesheets(): string[] {
  const tokens = readFileSync(join(STYLES_DIR, "tokens.css"), "utf8");

  // Read the import list rather than restating it: adding a Radix scale to
  // tokens.css must not silently leave it unmeasured.
  const imports = [...tokens.matchAll(/@import\s+"(@radix-ui\/colors\/[^"]+)"/g)].map((match) =>
    readFileSync(join(NODE_MODULES, match[1] ?? ""), "utf8"),
  );

  return [...imports, tokens];
}

/**
 * Every custom property in effect under `theme`, with `var()` references
 * resolved to a literal value.
 */
export function resolvePalette(theme: Theme): Map<string, string> {
  const applicable = SELECTORS[theme];
  const raw = new Map<string, string>();

  for (const sheet of stylesheets()) {
    for (const block of parseTopLevelBlocks(sheet)) {
      if (!block.selectors.some((selector) => applicable.has(selector))) continue;
      for (const [name, value] of block.declarations) raw.set(name, value);
    }
  }

  const resolved = new Map<string, string>();
  for (const name of raw.keys()) resolved.set(name, dereference(name, raw, new Set()));
  return resolved;
}

function dereference(name: string, raw: Map<string, string>, seen: Set<string>): string {
  const value = raw.get(name);
  if (value === undefined) throw new Error(`Undefined custom property: ${name}`);
  if (seen.has(name)) throw new Error(`Circular custom property: ${name}`);

  return value.replace(/var\(\s*(--[\w-]+)\s*\)/g, (_match, referenced: string) =>
    dereference(referenced, raw, new Set([...seen, name])),
  );
}

/** The colour a token resolves to under `theme`, as `#rrggbb`. */
export function colorOf(token: string, theme: Theme): string {
  const value = resolvePalette(theme).get(token);
  if (value === undefined) throw new Error(`No such token: ${token} (${theme})`);
  if (!/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`${token} is not a plain sRGB hex under ${theme}: ${value}`);
  }
  return value.toLowerCase();
}

function channelLuminance(channel: number): number {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

/** WCAG 2.2 relative luminance. */
export function relativeLuminance(hex: string): number {
  const [red, green, blue] = [1, 3, 5].map((offset) =>
    channelLuminance(Number.parseInt(hex.slice(offset, offset + 2), 16)),
  ) as [number, number, number];

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** WCAG 2.2 contrast ratio, 1 … 21. Order of arguments does not matter. */
export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];

  return (lighter + 0.05) / (darker + 0.05);
}

/** Contrast between two tokens under one theme, rounded the way it is reported. */
export function tokenContrast(foreground: string, background: string, theme: Theme): number {
  return (
    Math.round(contrastRatio(colorOf(foreground, theme), colorOf(background, theme)) * 100) / 100
  );
}
