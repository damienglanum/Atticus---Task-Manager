import { useCallback, useEffect, useRef, useState } from "react";

/** A deliberate pause, long enough to finish a short phrase without flicker. */
export const IDLE_PREVIEW_DELAY_MS = 1200;

/**
 * Switches a Markdown writing surface back to rendered reading mode after the
 * author pauses. It changes presentation only; callers still receive every raw
 * Markdown edit immediately and keep their existing save semantics.
 */
export function useIdlePreview(delay = IDLE_PREVIEW_DELAY_MS, initiallyPreviewing = false) {
  const [previewing, setPreviewing] = useState(initiallyPreviewing);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPending = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const beginEditing = useCallback(() => {
    cancelPending();
    setPreviewing(false);
  }, [cancelPending]);

  const showPreview = useCallback(() => {
    cancelPending();
    setPreviewing(true);
  }, [cancelPending]);

  const previewAfterPause = useCallback(
    (hasContent: boolean) => {
      cancelPending();
      if (!hasContent) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        setPreviewing(true);
      }, delay);
    },
    [cancelPending, delay],
  );

  useEffect(() => cancelPending, [cancelPending]);

  return { previewing, beginEditing, showPreview, previewAfterPause };
}
