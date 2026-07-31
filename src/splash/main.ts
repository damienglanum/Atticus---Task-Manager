/**
 * The splash window.
 *
 * A separate Tauri window, shown while the Rust side opens the database and the
 * main webview boots. It is deliberately not a React screen inside the app: by
 * the time React can paint, the slow part of a cold launch is already over, and
 * a "splash" that appears after the work is done is just a delay.
 *
 * **On the timing.** The supplied animation runs 5.067 seconds. That is a title
 * sequence, not a splash, and this application measures cold-launch-to-board as
 * a release gate (milestone 10). So the draw is compressed to `DRAW_MS`, and the
 * window closes on whichever is *later*: the end of the draw, or the app saying
 * it is ready. Nobody is ever held for the animation's sake beyond that — if the
 * app is ready first, the contours finish and it goes.
 *
 * The window is closed by Rust, from the `app_ready` command. This file only
 * has to make the wait look intentional.
 */
import { CONTOURS } from "@/components/ui/logoContours";

/** How long the full contour draw takes, start to finish. */
const DRAW_MS = 1500;

/** Each ring starts this long after the one inside it. */
const STAGGER_MS = 105;

/** How long one ring takes to draw itself. */
const RING_MS = 620;

const SVG_NS = "http://www.w3.org/2000/svg";

function build(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 360 360");
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");

  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("stroke", "var(--splash-stroke)");
  group.setAttribute("stroke-width", "2.2");
  group.setAttribute("stroke-linecap", "round");
  group.setAttribute("stroke-linejoin", "round");

  for (const d of CONTOURS) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    group.append(path);
  }

  svg.append(group);
  return svg;
}

function draw(svg: SVGSVGElement): void {
  const paths = [...svg.querySelectorAll("path")];

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion) {
    // The finished mark, held. Drawing eight lines is the one thing this screen
    // does, so there is nothing to degrade to except the result of it.
    for (const path of paths) path.style.opacity = "1";
    return;
  }

  paths.forEach((path, index) => {
    const length = path.getTotalLength();
    path.style.strokeDasharray = String(length);
    path.style.strokeDashoffset = String(length);

    path.animate(
      [
        { strokeDashoffset: length, opacity: 0, offset: 0 },
        { strokeDashoffset: length, opacity: 1, offset: 0.001 },
        { strokeDashoffset: 0, opacity: 1, offset: 1 },
      ],
      {
        delay: index * STAGGER_MS,
        duration: RING_MS,
        easing: "cubic-bezier(.65, 0, .35, 1)",
        fill: "forwards",
      },
    );
  });
}

const root = document.getElementById("splash");
if (root !== null) {
  const svg = build();
  root.append(svg);
  draw(svg);

  // Tells Rust the animation has had its moment. Rust closes this window on
  // whichever is later, this or the workspace finishing loading — so the
  // message is "I am done", not "close now".
  window.setTimeout(() => {
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("splash_animation_finished"))
      // Opened outside Tauri — the preview harness, or a plain browser. There
      // is nothing to tell, and nothing to report.
      .catch(() => undefined);
  }, DRAW_MS);
}
