import type { BoardTask } from "@/lib/bindings/BoardTask";

import { dueState, type DueState } from "./dates";

/**
 * What the board is currently showing.
 *
 * Filtering happens in the frontend, over the snapshot the board already holds,
 * rather than as a query. A board is a bounded set — one board's live tasks —
 * so filtering it costs nothing measurable, and doing it here means the result
 * appears as fast as a checkbox can be ticked, with no round trip and nothing to
 * keep in step.
 */
export interface BoardFilter {
  /** Free text matched against title and description, case-insensitively. */
  text: string;
  columnIds: string[];
  /** Priority levels, 0–4. */
  priorities: number[];
  labelIds: string[];
  due: DueState[];
}

export const EMPTY_FILTER: BoardFilter = {
  text: "",
  columnIds: [],
  priorities: [],
  labelIds: [],
  due: [],
};

/**
 * How many facets are narrowing the board.
 *
 * Counted by facet rather than by selected value, so "two labels" reads as one
 * active filter — which is how someone thinks about it when deciding what to
 * clear.
 */
export function activeFacetCount(filter: BoardFilter): number {
  return (
    (filter.text.trim() === "" ? 0 : 1) +
    (filter.columnIds.length === 0 ? 0 : 1) +
    (filter.priorities.length === 0 ? 0 : 1) +
    (filter.labelIds.length === 0 ? 0 : 1) +
    (filter.due.length === 0 ? 0 : 1)
  );
}

export function isFiltering(filter: BoardFilter): boolean {
  return activeFacetCount(filter) > 0;
}

/**
 * Whether a task survives the filter.
 *
 * Facets are combined with AND; values within a facet with OR. That is the
 * behaviour people expect without being told: ticking two labels widens the
 * label facet, ticking a priority as well narrows the whole thing.
 */
export function matches(task: BoardTask, filter: BoardFilter, today: string): boolean {
  const text = filter.text.trim().toLowerCase();
  if (text !== "") {
    const haystack = `${task.title}\n${task.description}`.toLowerCase();
    if (!haystack.includes(text)) return false;
  }

  if (filter.columnIds.length > 0 && !filter.columnIds.includes(task.columnId)) return false;
  if (filter.priorities.length > 0 && !filter.priorities.includes(task.priority)) return false;

  if (filter.labelIds.length > 0) {
    const hasOne = filter.labelIds.some((id) => task.labelIds.includes(id));
    if (!hasOne) return false;
  }

  if (filter.due.length > 0 && !filter.due.includes(dueState(task.dueDate, today))) return false;

  return true;
}

/** The filter with one value toggled in or out of a facet. */
export function toggle<T>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((each) => each !== value) : [...values, value];
}

/**
 * Reads a filter that was persisted, defensively.
 *
 * Anything unrecognised falls back to the empty filter rather than throwing: a
 * stored filter is data from a previous version of this application, and a board
 * that refuses to open because of a stale preference would be a poor trade for
 * type purity.
 */
export function parseFilter(raw: unknown): BoardFilter {
  if (typeof raw !== "object" || raw === null) return EMPTY_FILTER;

  const value = raw as Record<string, unknown>;
  const strings = (input: unknown): string[] =>
    Array.isArray(input) ? input.filter((each): each is string => typeof each === "string") : [];

  return {
    text: typeof value.text === "string" ? value.text : "",
    columnIds: strings(value.columnIds),
    labelIds: strings(value.labelIds),
    priorities: Array.isArray(value.priorities)
      ? value.priorities.filter(
          (each): each is number => typeof each === "number" && each >= 0 && each <= 4,
        )
      : [],
    due: Array.isArray(value.due)
      ? value.due.filter((each): each is DueState =>
          ["none", "overdue", "today", "soon", "future"].includes(each as string),
        )
      : [],
  };
}
