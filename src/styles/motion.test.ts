// @vitest-environment node
//
// US-24, asserted against the stylesheets rather than against a rendered page.
//
// The end-to-end suite can only observe the branch the reviewer's machine is
// actually in, and that machine is not asking for reduced motion. This reads the
// other branch — the one that matters and that nobody's development machine
// exercises by accident.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const STYLES = dirname(fileURLToPath(import.meta.url));

function reducedMotionBlock(file: string): string {
  const css = readFileSync(join(STYLES, file), "utf8");
  const start = css.indexOf("@media (prefers-reduced-motion: reduce)");

  expect(start, `${file} has no reduced-motion block`).toBeGreaterThan(-1);

  let depth = 0;
  let cursor = css.indexOf("{", start);
  const open = cursor;

  do {
    if (css[cursor] === "{") depth += 1;
    else if (css[cursor] === "}") depth -= 1;
    cursor += 1;
  } while (depth > 0 && cursor < css.length);

  return css.slice(open, cursor);
}

describe("prefers-reduced-motion", () => {
  it("zeroes both motion tokens, so anything driven by them stops", () => {
    const block = reducedMotionBlock("tokens.css");

    expect(block).toMatch(/--duration-fast:\s*0ms/);
    expect(block).toMatch(/--duration-base:\s*0ms/);
  });

  it("also clamps animation that never went through a token", () => {
    // dnd-kit, Radix and the browser's own smooth scrolling animate without
    // asking us. The tokens cannot reach those, so the global rule does — and
    // it has to be `!important`, because the libraries set the properties
    // inline.
    const block = reducedMotionBlock("global.css");

    expect(block).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    expect(block).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
    expect(block).toMatch(/scroll-behavior:\s*auto\s*!important/);
  });

  it("leaves the ordinary values alone outside the query", () => {
    // A guard against "fixing" reduced motion by simply removing the motion:
    // the durations must still exist for everyone who did not ask for this.
    const tokens = readFileSync(join(STYLES, "tokens.css"), "utf8");
    const beforeQuery = tokens.slice(0, tokens.indexOf("@media (prefers-reduced-motion"));

    expect(beforeQuery).toMatch(/--duration-fast:\s*100ms/);
    expect(beforeQuery).toMatch(/--duration-base:\s*160ms/);
  });
});
