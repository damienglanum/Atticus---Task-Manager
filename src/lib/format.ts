/**
 * Display formatting. Pure functions, so they are testable without rendering.
 */

const UNITS = ["B", "kB", "MB", "GB", "TB"] as const;

/** Human-readable file size. Uses decimal units, matching Finder. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1000) return `${String(Math.round(bytes))} B`;

  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }

  // One decimal below 10 (1.4 MB), none above (14 MB): more precision on small
  // numbers is informative, on large numbers it is noise.
  const decimals = value < 10 ? 1 : 0;
  return `${value.toFixed(decimals)} ${UNITS[unit] ?? "B"}`;
}
