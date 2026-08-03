import { afterEach, describe, expect, it, vi } from "vitest";

import { CONTOURS } from "@/components/ui/logoContours";

import { buildSplashScene, playSplashScene, SPLASH_INTRO_MS, type SplashScene } from "./scene";

const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, "animate");

function root(): HTMLDivElement {
  const element = document.createElement("div");
  element.innerHTML = '<span data-testid="stale">Loading</span>';
  document.body.append(element);
  return element;
}

function expectSettled(scene: SplashScene): void {
  expect(scene.mark.style.opacity).toBe("1");
  expect(scene.mark.style.transform).toBe("none");
  expect(scene.rule.style.opacity).toBe("1");
  expect(scene.rule.style.transform).toBe("none");
  expect(scene.wordmark.style.opacity).toBe("1");
  expect(scene.wordmark.style.transform).toBe("none");
  expect(scene.context.style.opacity).toBe("1");
  expect(scene.context.style.transform).toBe("none");

  scene.mainPaths.forEach((path, index) => {
    expect(path.style.opacity).toBe(String(Math.max(0.56, 0.98 - index * 0.055)));
    expect(path.style.stroke).toBe("var(--splash-accent)");
    expect(path.style.strokeDasharray).toBe("none");
    expect(path.style.strokeDashoffset).toBe("0");
  });
  for (const path of scene.glowPaths) expect(path.style.opacity).toBe("0");
}

afterEach(() => {
  document.body.replaceChildren();

  if (originalAnimate === undefined) {
    Reflect.deleteProperty(Element.prototype, "animate");
  } else {
    Object.defineProperty(Element.prototype, "animate", originalAnimate);
  }
});

describe("buildSplashScene", () => {
  it("builds the complete branded frame and replaces placeholder content", () => {
    const host = root();

    const scene = buildSplashScene(host);

    expect(host.children).toHaveLength(1);
    expect(host.firstElementChild).toBe(scene.composition);
    expect(host.querySelector("[data-testid='stale']")).not.toBeInTheDocument();
    expect(scene.composition).toHaveClass("splash-composition");
    expect(scene.mark).toHaveClass("splash-mark");
    expect(scene.wordmark).toHaveTextContent("Atticus");
    expect(scene.context).toHaveTextContent("Local workspace");
    expect(scene.mainPaths).toHaveLength(CONTOURS.length);
    expect(scene.glowPaths).toHaveLength(CONTOURS.length);
    expect(host.querySelectorAll(".contour-track path")).toHaveLength(CONTOURS.length);
    expect(host.querySelector("svg")).toHaveAttribute("viewBox", "0 0 360 360");
    expect(host.querySelector("#contour-glow feGaussianBlur")).toHaveAttribute(
      "stdDeviation",
      "3.2",
    );
  });
});

describe("playSplashScene", () => {
  it("settles immediately without calling Web Animations when motion is reduced", async () => {
    const scene = buildSplashScene(root());
    const animate = vi.fn(() => ({ finished: Promise.resolve() }) as unknown as Animation);
    Object.defineProperty(Element.prototype, "animate", {
      configurable: true,
      value: animate,
    });

    await playSplashScene(scene, true);

    expect(animate).not.toHaveBeenCalled();
    expectSettled(scene);
  });

  it("falls back to the same legible final frame when Web Animations is unavailable", async () => {
    const scene = buildSplashScene(root());
    Object.defineProperty(scene.composition, "animate", {
      configurable: true,
      value: undefined,
    });

    await expect(playSplashScene(scene, false)).resolves.toBeUndefined();

    expectSettled(scene);
  });

  it("animates every contour and waits on the essential scene clock", async () => {
    const scene = buildSplashScene(root());
    const animate = vi.fn(() => ({ finished: Promise.resolve() }) as unknown as Animation);
    Object.defineProperty(Element.prototype, "animate", {
      configurable: true,
      value: animate,
    });
    scene.mainPaths.forEach((path, index) => {
      Object.defineProperty(path, "getTotalLength", {
        configurable: true,
        value: vi.fn(() => 100 + index),
      });
    });

    await playSplashScene(scene, false);

    // Mark, divider, wordmark, context, two passes per contour, and one scene clock.
    expect(animate).toHaveBeenCalledTimes(5 + CONTOURS.length * 2);
    expect(animate).toHaveBeenCalledWith([{ opacity: 1 }, { opacity: 1 }], {
      duration: SPLASH_INTRO_MS,
    });
    expectSettled(scene);
  });
});
