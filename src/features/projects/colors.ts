import { PROJECT_COLORS } from "@/lib/schemas";

function knownColor(color: string): string {
  return (PROJECT_COLORS as readonly string[]).includes(color) ? color : "slate";
}

/**
 * Colours are stored as names and resolved to a CSS custom property here, so a
 * palette change never requires touching stored data. The name is checked
 * against the known palette before it reaches a style attribute — a value read
 * from the database is data, and data does not get to name arbitrary variables.
 */
export function colorVariable(color: string): string {
  return `var(--project-${knownColor(color)})`;
}

/** A theme-aware tinted surface for a label pill, rather than its solid dot. */
export function labelColorVariable(color: string): string {
  return `var(--label-${knownColor(color)})`;
}
