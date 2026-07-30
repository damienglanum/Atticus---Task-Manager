import { useEffect } from "react";

/**
 * Application-wide keyboard shortcuts.
 *
 * Bound on `window` in the capture phase so a shortcut works wherever focus
 * happens to be — but never while the user is typing, unless the binding says
 * otherwise. `⌘K` is deliberately allowed from inside a text field, because
 * "search from anywhere" is the whole point of it; `⌘Z` is not, because inside a
 * text field it means undo the typing.
 */
export interface Shortcut {
  /** Lower-case key name, as reported by `KeyboardEvent.key`. */
  key: string;
  /** ⌘ on macOS, Ctrl elsewhere. */
  meta?: boolean;
  shift?: boolean;
  /** Whether it should fire while a text field has focus. */
  whileTyping?: boolean;
  run: () => void;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

export function useShortcuts(shortcuts: Shortcut[]): void {
  useEffect(() => {
    function handle(event: KeyboardEvent) {
      // `metaKey` on macOS, `ctrlKey` elsewhere. Accepting either would make
      // Ctrl+K fire on a Mac, where it is "delete to end of line".
      const primary = navigator.platform.toLowerCase().includes("mac")
        ? event.metaKey
        : event.ctrlKey;

      for (const shortcut of shortcuts) {
        if (event.key.toLowerCase() !== shortcut.key) continue;
        if ((shortcut.meta ?? false) !== primary) continue;
        if ((shortcut.shift ?? false) !== event.shiftKey) continue;
        if (!(shortcut.whileTyping ?? false) && isTyping(event.target)) continue;

        event.preventDefault();
        shortcut.run();
        return;
      }
    }

    window.addEventListener("keydown", handle, true);
    return () => {
      window.removeEventListener("keydown", handle, true);
    };
  }, [shortcuts]);
}
