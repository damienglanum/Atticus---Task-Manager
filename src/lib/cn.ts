import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Joins class names, letting a later utility beat an earlier one of the same
 * kind. Without the merge, `cn("p-2", props.className)` silently loses to
 * whichever Tailwind emitted last, which is a coin toss.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
