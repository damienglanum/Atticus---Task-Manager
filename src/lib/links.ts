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

/** Turns a pasted web address into the canonical form stored for a task. */
export function normalizeWebUrl(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;

  const candidate = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.hostname === "") {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

/** A compact human-readable name for a stored web address. */
export function webLinkName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
