/**
 * The parts of product-spec §10 that only a real renderer can answer.
 *
 * Contrast is measured against the stylesheet in `src/styles/contrast.test.ts`,
 * where the numbers come from the values themselves. What that cannot tell you
 * is whether a focused control actually draws a ring, whether a target is 24 px
 * once it is laid out, or whether a person with no pointer can get to the end of
 * a task. jsdom cannot either — it has no layout and no focus model. So those
 * three live here, against the built binary.
 */
import {
  createProject,
  openMenuAt,
  openSettings,
  pinWindow,
  waitForAppReady,
} from "../support/app.js";

/** WCAG 2.2 SC 2.5.8. The design raises it to 32 for anything primary. */
const MINIMUM_TARGET = 24;

interface Measured {
  name: string;
  width: number;
  height: number;
}

/** Every control the user can reach right now, with its laid-out size. */
async function measureTargets(): Promise<Measured[]> {
  return browser.execute(() => {
    const selector = "button, [role='button'], a[href], input, select, textarea, [tabindex='0']";

    return Array.from(document.querySelectorAll(selector))
      .filter((element) => {
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") return false;
        // A checkbox hidden behind its own label is operated by clicking the
        // label, so the label is the target and this is not one.
        return !(element instanceof HTMLInputElement && style.opacity === "0");
      })
      .map((element) => {
        const box = element.getBoundingClientRect();
        const label = element.getAttribute("aria-label") ?? element.textContent.trim();
        return {
          name: label.slice(0, 40) || element.tagName,
          width: box.width,
          height: box.height,
        };
      })
      .filter((target) => target.width > 0 && target.height > 0);
  });
}

/** Milliseconds from a CSS time, which WebKit reports as `.1s` rather than `100ms`. */
function milliseconds(value: string): number {
  const seconds = value.trim().endsWith("ms") ? 1 : 1000;
  return Number.parseFloat(value) * seconds;
}

describe("accessibility", () => {
  before(async () => {
    await createProject("Accessibility");
  });

  it("gives every reachable control at least a 24 px target", async () => {
    await waitForAppReady();

    const undersized = (await measureTargets()).filter(
      (target) => target.width < MINIMUM_TARGET || target.height < MINIMUM_TARGET,
    );

    expect(
      undersized.map((target) => `${target.name} ${String(target.width)}×${String(target.height)}`),
    ).toStrictEqual([]);
  });

  it("leaves every control in the tab order, in document order", async () => {
    // The keyboard pass, asserted structurally because it cannot be driven.
    //
    // Keys *do* reach the page — a `keydown` listener on a focused button sees
    // `Enter` arrive from `browser.keys`. What WKWebView will not do for a
    // synthetic key is perform its **default action**, and focus navigation is
    // Tab's default action. So the event lands and nothing moves, with
    // `browser.keys`, with `performActions` and with `elementSendKeys` alike.
    // Four mechanisms, one cause. See `docs/testing.md`.
    //
    // What can still be checked on the real, laid-out document is the thing Tab
    // would be checking: that every control is *in* the order, and that the
    // order is document order. With no positive `tabindex` anywhere, tab order
    // is document order by definition — which is product-spec §10's "reachable
    // and operable by keyboard, in a logical order" without needing to walk it.
    await waitForAppReady();

    const findings = await browser.execute(() => {
      const CONTROLS = "button, a[href], input, select, textarea, [contenteditable='true']";

      const visible = (element: Element) => {
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden") return false;
        if (element.closest("[aria-hidden='true']") !== null) return false;
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      };

      const problems: string[] = [];
      const name = (element: Element) =>
        `${element.tagName.toLowerCase()}:${element.getAttribute("aria-label") ?? element.textContent.trim().slice(0, 30)}`;

      // A positive tabindex re-orders the whole document and is the single
      // easiest way to make a keyboard pass illogical.
      for (const element of document.querySelectorAll("[tabindex]")) {
        if (Number(element.getAttribute("tabindex")) > 0) {
          problems.push(`positive tabindex on ${name(element)}`);
        }
      }

      // `tabindex="-1"` takes a control out of the order. That is correct inside
      // a composite widget, which owns one entry point and moves within itself
      // by arrow keys — and wrong anywhere else, where it strands the control.
      const COMPOSITE = "[role='tablist'], [role='menu'], [role='listbox'], [role='radiogroup']";
      for (const element of document.querySelectorAll(CONTROLS)) {
        if (!visible(element)) continue;
        if (element.getAttribute("tabindex") !== "-1") continue;
        if (element.closest(COMPOSITE) === null) {
          problems.push(`stranded at tabindex=-1: ${name(element)}`);
        }
      }

      // And each composite must offer exactly one way in: none means the widget
      // cannot be reached at all, several means Tab stops inside it repeatedly
      // instead of moving past it.
      for (const composite of document.querySelectorAll(COMPOSITE)) {
        if (!visible(composite)) continue;
        const entries = Array.from(composite.querySelectorAll(CONTROLS))
          .filter(visible)
          .filter((element) => element.getAttribute("tabindex") !== "-1");
        if (entries.length !== 1) {
          problems.push(
            `${composite.getAttribute("role") ?? "composite"} has ${String(entries.length)} tab stops, expected 1`,
          );
        }
      }

      return problems;
    });

    expect(findings).toStrictEqual([]);
  });

  it("draws the focus ring on a menu row reached with the arrow keys", async () => {
    // Arrow-key navigation inside a Radix menu is the one focus movement this
    // driver actually performs — `Tab` is dispatched but never navigates, so
    // there is no walking the interface with it. See `docs/testing.md`.
    //
    // It is still a real assertion about a real keyboard-focus indicator: the
    // menu row is where the highlight was measured at 1.1:1 in the light theme,
    // and it now carries the same ring as everything else.
    await waitForAppReady();
    await openMenuAt('button[aria-label="Actions for Backlog"]');

    await browser.keys("ArrowDown");

    const highlighted = await browser.execute(() => {
      const row = document.querySelector('[role="menuitem"][data-highlighted]');
      if (row === null) return { name: "«nothing highlighted»", style: "none", width: 0 };
      const style = getComputedStyle(row);
      return {
        name: row.textContent.trim().slice(0, 40),
        style: style.outlineStyle,
        width: Number.parseFloat(style.outlineWidth),
      };
    });

    // Closed before asserting, not after: a failed assertion would otherwise
    // leave the menu open and turn one finding into three. `docs/testing.md`
    // asks specs to close what they open, and that has to survive failure.
    await browser.keys("Escape");
    await $('[role="menu"]').waitForDisplayed({ reverse: true });

    // Reported as one object so a failure names the row that has no ring.
    expect(highlighted).toStrictEqual({
      name: highlighted.name,
      style: "solid",
      width: 2,
    });
  });

  it("honours prefers-reduced-motion by zeroing the durations, not by hiding them", async () => {
    // The tokens are zeroed under the media query and the global rule clamps
    // every animation. Asserted through `matchMedia` so the test states which
    // branch it measured rather than silently passing on the wrong one.
    await waitForAppReady();

    const motion = await browser.execute(() => {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const root = getComputedStyle(document.documentElement);
      return {
        reduced,
        fast: root.getPropertyValue("--duration-fast").trim(),
        base: root.getPropertyValue("--duration-base").trim(),
      };
    });

    if (motion.reduced) {
      expect(milliseconds(motion.fast)).toBe(0);
      expect(milliseconds(motion.base)).toBe(0);
    } else {
      // The machine running the suite is not asking for reduced motion, so the
      // ordinary values are what must be in effect. The zeroed branch is
      // asserted by `src/styles/motion.test.ts`, which reads the media query
      // itself; this is the half that can be observed in a real window.
      expect(milliseconds(motion.fast)).toBe(100);
      expect(milliseconds(motion.base)).toBe(160);
    }
  });

  it("switches theme without reloading the window", async () => {
    // US-23: "Switching does not reload or flash." A reload is observable — a
    // value parked on `window` does not survive one.
    await pinWindow();
    await browser.execute(() => {
      (window as unknown as Record<string, unknown>).__themeSwitchWitness = "alive";
    });

    await openSettings();
    await $('//div[@role="dialog"]//button[normalize-space(.)="General"]').click();
    await $('//div[@role="dialog"]//label[normalize-space(.)="Light"]').click();

    // The class is written by an effect that runs after the preference query
    // settles, so it arrives a frame or two later. Waiting for it is the point —
    // the assertion is that it arrives *without a reload*, not that it is
    // synchronous.
    await browser.waitUntil(
      async () => await browser.execute(() => document.documentElement.classList.contains("light")),
      { timeoutMsg: "the light theme never took effect" },
    );

    const after = await browser.execute(() => ({
      witness: (window as unknown as Record<string, unknown>).__themeSwitchWitness,
      theme: document.documentElement.className,
      colorScheme: document.documentElement.style.colorScheme,
    }));

    expect(after.witness).toBe("alive");
    expect(after.theme).toContain("light");
    expect(after.colorScheme).toBe("light");

    await $("label=Dark").click();
    await browser.keys("Escape");
  });
});
