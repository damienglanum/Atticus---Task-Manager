import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

/**
 * jsdom implements no layout, so it has no `scrollIntoView`.
 *
 * Stubbed here rather than guarded in the components: scrolling the highlighted
 * row into view is real behaviour in the product, and writing
 * `element.scrollIntoView?.()` everywhere would be shaping the application
 * around a gap in the test environment.
 *
 * Guarded because this setup file also runs for tests in the `node`
 * environment — the schema-parity test reads `validate.rs` from disk — where
 * there is no DOM at all.
 */
if (typeof Element !== "undefined") {
  Element.prototype.scrollIntoView = function scrollIntoView() {
    // Nothing to do without layout.
  };
}

afterEach(() => {
  cleanup();
});
