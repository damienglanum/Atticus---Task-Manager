import { describe, expect, it } from "vitest";

import type { ImportPlan } from "@/lib/bindings/ImportPlan";
import { describePlan } from "./importPlan";

function plan(partial: Partial<ImportPlan>): ImportPlan {
  return {
    projects: 0,
    boards: 0,
    columns: 0,
    tasks: 0,
    subtasks: 0,
    labels: 0,
    fileRefs: 0,
    savedFilters: 0,
    notes: 0,
    ...partial,
  };
}

describe("describePlan", () => {
  it("states the counts in the order the user thinks about them", () => {
    expect(describePlan(plan({ projects: 3, boards: 11, tasks: 214 }))).toBe(
      "3 projects, 11 boards, 214 tasks",
    );
  });

  it("leaves out the kinds that would create nothing", () => {
    // A list of zeroes buries the numbers that matter.
    expect(describePlan(plan({ tasks: 1 }))).toBe("1 task");
  });

  it("says so plainly when the file would create nothing at all", () => {
    // Importing an empty project back is a no-op, not an error, so this has to
    // read as a statement rather than a failure.
    expect(describePlan(plan({}))).toBe("nothing — the file is empty");
  });

  it("gets the singular right for every kind", () => {
    expect(
      describePlan(
        plan({
          projects: 1,
          boards: 1,
          columns: 1,
          tasks: 1,
          subtasks: 1,
          labels: 1,
          fileRefs: 1,
          savedFilters: 1,
        }),
      ),
    ).toBe(
      "1 project, 1 board, 1 column, 1 task, 1 subtask, 1 label, 1 file reference, 1 saved filter",
    );
  });
});
