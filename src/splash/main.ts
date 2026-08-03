/**
 * The splash window.
 *
 * This stays outside React and uses only SVG plus the browser's native Web
 * Animations API. Loading an application framework, WebGL context, or timeline
 * library before the first useful paint would make the launch screen the cause
 * of the delay it exists to cover.
 */
import { buildSplashScene, playSplashScene, SPLASH_INTRO_MS } from "./scene";

/** A broken animation API must never be able to hold the application hostage. */
const ANIMATION_WATCHDOG_MS = SPLASH_INTRO_MS + 250;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function reportFinished(): Promise<void> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("splash_animation_finished");
  } catch {
    // Opened outside Tauri — a visual preview or plain browser. There is
    // nothing to tell, and the scene remains visible for inspection.
  }
}

const root = document.getElementById("splash");
void (async () => {
  if (root !== null) {
    root.setAttribute("role", "status");
    root.setAttribute("aria-label", "Atticus is opening");
    const scene = buildSplashScene(root);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    await Promise.race([
      playSplashScene(scene, reducedMotion),
      wait(reducedMotion ? 0 : ANIMATION_WATCHDOG_MS),
    ]);
  }

  // Rust closes this window on whichever is later: this completed intro or the
  // workspace finishing its own boot. Reporting also happens if the root was
  // missing, so broken markup fails open instead of trapping the user here.
  await reportFinished();
})().catch(() => {
  void reportFinished();
});
