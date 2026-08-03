import type { ImportPlan } from "@/lib/bindings/ImportPlan";

/**
 * The dry-run summary, in words: "3 projects, 11 boards, 214 tasks".
 *
 * Product-spec §7.2 requires the user to be told what an import *would* do
 * before it does it. Kinds that would create nothing are left out entirely
 * rather than listed as "0 labels" — a list of zeroes buries the numbers that
 * matter.
 */
export function describePlan(plan: ImportPlan): string {
  const parts: [number, string][] = [
    [plan.projects, "project"],
    [plan.boards, "board"],
    [plan.columns, "column"],
    [plan.tasks, "task"],
    [plan.subtasks, "subtask"],
    [plan.labels, "label"],
    [plan.fileRefs, "file reference"],
    [plan.linkRefs, "web link"],
    [plan.savedFilters, "saved filter"],
  ];

  const counted = parts
    .filter(([count]) => count > 0)
    .map(([count, noun]) => `${String(count)} ${noun}${count === 1 ? "" : "s"}`);

  return counted.length === 0 ? "nothing — the file is empty" : counted.join(", ");
}
