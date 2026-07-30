/**
 * Whether a link is one we are willing to hand to the operating system.
 *
 * An allow-list, not a deny-list: anything not explicitly permitted stays inert
 * text. `new URL` also rejects the malformed strings a hand-written regex would
 * wave through.
 *
 * This mirrors the scope in `src-tauri/capabilities/default.json`, which is the
 * boundary that actually enforces it. Two nets, deliberately, at a place where a
 * pasted string decides what happens.
 */
export function isOpenable(href: string): boolean {
  try {
    const scheme = new URL(href).protocol;
    return scheme === "http:" || scheme === "https:" || scheme === "mailto:";
  } catch {
    return false;
  }
}
