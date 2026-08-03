import { CONTOURS } from "@/components/ui/logoContours";

/** The longest essential animation. Ambient breathing may continue while booting. */
export const SPLASH_INTRO_MS = 1_650;

const SVG_NS = "http://www.w3.org/2000/svg";
const RING_DELAYS = [0, 62, 132, 212, 304, 408, 526, 658] as const;
const RING_MS = 760;

export interface SplashScene {
  composition: HTMLDivElement;
  mark: HTMLDivElement;
  mainPaths: SVGPathElement[];
  glowPaths: SVGPathElement[];
  rule: HTMLSpanElement;
  wordmark: HTMLHeadingElement;
  context: HTMLParagraphElement;
}

function svgElement<K extends keyof SVGElementTagNameMap>(
  document: Document,
  name: K,
): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, name);
}

function contourGroup(document: Document, className: string): SVGGElement {
  const group = svgElement(document, "g");
  group.setAttribute("class", className);
  group.setAttribute("fill", "none");
  group.setAttribute("stroke-width", "2.2");
  group.setAttribute("stroke-linecap", "round");
  group.setAttribute("stroke-linejoin", "round");

  for (const d of CONTOURS) {
    const path = svgElement(document, "path");
    path.setAttribute("d", d);
    group.append(path);
  }

  return group;
}

/** Builds the complete static frame first; animation only changes its presentation. */
export function buildSplashScene(root: HTMLElement): SplashScene {
  const document = root.ownerDocument;
  const composition = document.createElement("div");
  composition.className = "splash-composition";

  const mark = document.createElement("div");
  mark.className = "splash-mark";
  const halo = document.createElement("span");
  halo.className = "splash-halo";
  halo.setAttribute("aria-hidden", "true");

  const svg = svgElement(document, "svg");
  svg.setAttribute("viewBox", "0 0 360 360");
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");

  const definitions = svgElement(document, "defs");
  const filter = svgElement(document, "filter");
  filter.setAttribute("id", "contour-glow");
  filter.setAttribute("x", "-30%");
  filter.setAttribute("y", "-30%");
  filter.setAttribute("width", "160%");
  filter.setAttribute("height", "160%");
  const blur = svgElement(document, "feGaussianBlur");
  blur.setAttribute("stdDeviation", "3.2");
  filter.append(blur);
  definitions.append(filter);

  const track = contourGroup(document, "contour-track");
  const glow = contourGroup(document, "contour-glow");
  const main = contourGroup(document, "contour-main");
  svg.append(definitions, track, glow, main);
  mark.append(halo, svg);

  const rule = document.createElement("span");
  rule.className = "splash-rule";
  rule.setAttribute("aria-hidden", "true");

  const copy = document.createElement("div");
  copy.className = "splash-copy";
  const wordmark = document.createElement("h1");
  wordmark.className = "splash-wordmark";
  wordmark.textContent = "Atticus";
  const context = document.createElement("p");
  context.className = "splash-context";
  const contextDot = document.createElement("span");
  contextDot.className = "splash-context-dot";
  contextDot.setAttribute("aria-hidden", "true");
  const contextText = document.createElement("span");
  contextText.textContent = "Local workspace";
  context.append(contextDot, contextText);
  copy.append(wordmark, context);

  composition.append(mark, rule, copy);
  root.replaceChildren(composition);

  return {
    composition,
    mark,
    mainPaths: [...main.querySelectorAll("path")],
    glowPaths: [...glow.querySelectorAll("path")],
    rule,
    wordmark,
    context,
  };
}

/** A legible completed state for Reduced Motion and animation API fallbacks. */
export function settleSplashScene(scene: SplashScene): void {
  scene.mark.style.opacity = "1";
  scene.mark.style.transform = "none";
  scene.rule.style.opacity = "1";
  scene.rule.style.transform = "none";
  scene.wordmark.style.opacity = "1";
  scene.wordmark.style.transform = "none";
  scene.context.style.opacity = "1";
  scene.context.style.transform = "none";

  scene.mainPaths.forEach((path, index) => {
    path.style.opacity = String(Math.max(0.56, 0.98 - index * 0.055));
    path.style.stroke = "var(--splash-accent)";
    path.style.strokeDasharray = "none";
    path.style.strokeDashoffset = "0";
  });
  for (const path of scene.glowPaths) path.style.opacity = "0";
}

function pathLength(path: SVGPathElement): number | null {
  try {
    const length = path.getTotalLength();
    return Number.isFinite(length) && length > 0 ? length : null;
  } catch {
    return null;
  }
}

/**
 * Plays one restrained intro and resolves when its last essential frame lands.
 * The CSS halo may keep breathing afterward if a cold database still needs time.
 */
export async function playSplashScene(scene: SplashScene, reducedMotion: boolean): Promise<void> {
  if (reducedMotion || typeof scene.composition.animate !== "function") {
    settleSplashScene(scene);
    return;
  }

  const animations: Animation[] = [];
  animations.push(
    scene.mark.animate(
      [
        { opacity: 0, transform: "translateX(-5px) scale(0.955)" },
        { opacity: 1, transform: "translateX(0) scale(1)" },
      ],
      {
        duration: 1_180,
        easing: "cubic-bezier(.2, .75, .25, 1)",
        fill: "both",
      },
    ),
    scene.rule.animate(
      [
        { opacity: 0, transform: "scaleY(0)" },
        { opacity: 1, transform: "scaleY(1)" },
      ],
      {
        delay: 250,
        duration: 720,
        easing: "cubic-bezier(.2, .75, .25, 1)",
        fill: "both",
      },
    ),
    scene.wordmark.animate(
      [
        { opacity: 0, transform: "translateY(8px)", letterSpacing: "0.015em" },
        { opacity: 1, transform: "translateY(0)", letterSpacing: "-0.035em" },
      ],
      {
        delay: 470,
        duration: 760,
        easing: "cubic-bezier(.2, .75, .25, 1)",
        fill: "both",
      },
    ),
    scene.context.animate(
      [
        { opacity: 0, transform: "translateY(5px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      {
        delay: 780,
        duration: 560,
        easing: "cubic-bezier(.2, .75, .25, 1)",
        fill: "both",
      },
    ),
  );

  scene.mainPaths.forEach((path, index) => {
    const glowPath = scene.glowPaths[index];
    const length = pathLength(path);
    if (length === null || glowPath === undefined) return;

    const delay = RING_DELAYS[index] ?? index * 62;
    const finalOpacity = Math.max(0.56, 0.98 - index * 0.055);
    for (const candidate of [path, glowPath]) {
      candidate.style.strokeDasharray = String(length);
      candidate.style.strokeDashoffset = String(length);
    }

    animations.push(
      path.animate(
        [
          { strokeDashoffset: length, opacity: 0, stroke: "var(--splash-stroke)" },
          {
            strokeDashoffset: length,
            opacity: 0.25,
            stroke: "var(--splash-stroke)",
            offset: 0.03,
          },
          {
            strokeDashoffset: 0,
            opacity: 1,
            stroke: "var(--splash-stroke)",
            offset: 0.76,
          },
          {
            strokeDashoffset: 0,
            opacity: finalOpacity,
            stroke: "var(--splash-accent)",
          },
        ],
        {
          delay,
          duration: RING_MS,
          easing: "cubic-bezier(.65, 0, .35, 1)",
          fill: "forwards",
        },
      ),
      glowPath.animate(
        [
          { strokeDashoffset: length, opacity: 0 },
          { strokeDashoffset: length, opacity: 0.2, offset: 0.03 },
          { strokeDashoffset: 0, opacity: 0.62, offset: 0.72 },
          { strokeDashoffset: 0, opacity: 0 },
        ],
        {
          delay,
          duration: RING_MS,
          easing: "cubic-bezier(.65, 0, .35, 1)",
          fill: "forwards",
        },
      ),
    );
  });

  // One compositor-only clock defines the hand-off instead of a magic timeout.
  const clock = scene.composition.animate([{ opacity: 1 }, { opacity: 1 }], {
    duration: SPLASH_INTRO_MS,
  });
  animations.push(clock);

  await Promise.allSettled(animations.map((animation) => animation.finished));
  settleSplashScene(scene);
}
