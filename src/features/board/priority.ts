import { AlertOctagon, ChevronDown, ChevronsUp, ChevronUp, Minus } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * The priority scale: fixed, five levels, never user-editable (US-15 AC1).
 *
 * Each level carries a distinct **glyph** as well as a colour, so the scale
 * survives greyscale printing, a colour-blind reader, and a monochrome display
 * (US-15 AC2). The glyphs are directional rather than decorative — chevrons that
 * point further up the higher the priority — so the ordering is legible without
 * reading the label.
 */
export interface PriorityLevel {
  value: number;
  label: string;
  icon: LucideIcon;
  /** Tailwind text colour. Never the only signal.  */
  tone: string;
}

const NONE: PriorityLevel = { value: 0, label: "None", icon: Minus, tone: "text-fg-secondary" };

export const PRIORITIES: readonly PriorityLevel[] = [
  NONE,
  { value: 1, label: "Low", icon: ChevronDown, tone: "text-fg-secondary" },
  { value: 2, label: "Medium", icon: ChevronUp, tone: "text-accent-fg" },
  { value: 3, label: "High", icon: ChevronsUp, tone: "text-warning-fg" },
  { value: 4, label: "Urgent", icon: AlertOctagon, tone: "text-danger-fg" },
] as const;

/// A stored priority outside the scale can only come from a database edited by
/// hand, and rendering nothing at all would be worse than rendering "None".
export function priorityLevel(value: number): PriorityLevel {
  return PRIORITIES[value] ?? NONE;
}
