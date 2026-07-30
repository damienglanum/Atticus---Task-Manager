/**
 * Due dates as calendar dates.
 *
 * A due date is `YYYY-MM-DD` end to end — never an instant. A task due "on the
 * 14th" is due on the 14th wherever the user is, and storing a moment in time
 * would make it drift across a timezone change and land on the wrong day around
 * a daylight-saving boundary. That decision removes the entire class of bug
 * rather than handling it.
 */

export type DueState = "none" | "overdue" | "today" | "soon" | "future";

/** Every due-date state, in the order a filter should list them. */
export const DUE_STATES: readonly DueState[] = [
  "overdue",
  "today",
  "soon",
  "future",
  "none",
] as const;

/** Days from today within which a date counts as "soon" (US-16 AC1). */
export const SOON_DAYS = 3;

/** Today, in the user's own timezone, as `YYYY-MM-DD`. */
export function todayIso(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${String(year)}-${month}-${day}`;
}

/**
 * Whole days between two calendar dates.
 *
 * Both are parsed at UTC midnight purely to subtract them. That is not a
 * timezone conversion — it is arithmetic on two labels that both mean "a day",
 * and doing it at UTC keeps the subtraction free of daylight-saving jumps.
 */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return Number.NaN;

  return Math.round((to - from) / 86_400_000);
}

export function dueState(dueDate: string | null, today: string = todayIso()): DueState {
  if (dueDate === null || dueDate === "") return "none";

  const days = daysBetween(today, dueDate);
  if (Number.isNaN(days)) return "none";
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days <= SOON_DAYS) return "soon";
  return "future";
}

/**
 * How a due date reads on a card.
 *
 * Every state carries words, not only a colour — "Overdue by 2 days" rather than
 * a red dot (US-16 AC2). The icon is chosen by the caller from the same state.
 */
export function describeDue(dueDate: string | null, today: string = todayIso()): string {
  const state = dueState(dueDate, today);
  if (state === "none" || dueDate === null) return "";

  const days = daysBetween(today, dueDate);

  switch (state) {
    case "overdue": {
      const late = Math.abs(days);
      return late === 1 ? "Overdue by 1 day" : `Overdue by ${String(late)} days`;
    }
    case "today":
      return "Due today";
    case "soon":
      return days === 1 ? "Due tomorrow" : `Due in ${String(days)} days`;
    default:
      return `Due ${formatDate(dueDate)}`;
  }
}

/** A date as a person would write it, e.g. "14 Aug 2026". */
export function formatDate(iso: string): string {
  const parsed = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed)) return iso;

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

/** Minutes as a short duration: 90 → "1h 30m". */
export function formatEstimate(minutes: number | null): string {
  if (minutes === null || minutes <= 0) return "";

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${String(rest)}m`;
  if (rest === 0) return `${String(hours)}h`;
  return `${String(hours)}h ${String(rest)}m`;
}

/** Parses "1h 30m", "90", "2h" into minutes. Returns null for an empty field. */
export function parseEstimate(input: string): number | null | "invalid" {
  const trimmed = input.trim().toLowerCase();
  if (trimmed === "") return null;

  if (/^\d+$/.test(trimmed)) return Number(trimmed);

  const match = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?$/.exec(trimmed);
  if (match === null || (match[1] === undefined && match[2] === undefined)) return "invalid";

  return Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
}
