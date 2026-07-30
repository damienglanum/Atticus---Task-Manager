import { describe, expect, it } from "vitest";

import type { BoardTask } from "@/lib/bindings/BoardTask";

import {
  activeFacetCount,
  EMPTY_FILTER,
  isFiltering,
  matches,
  parseFilter,
  toggle,
  type BoardFilter,
} from "./filter";

const TODAY = "2026-07-30";

function task(overrides: Partial<BoardTask> = {}): BoardTask {
  return {
    id: "t1",
    projectId: "p1",
    boardId: "b1",
    columnId: "todo",
    number: 1,
    title: "Write the release notes",
    description: "",
    priority: 0,
    dueDate: null,
    estimateMinutes: null,
    position: 0,
    archivedAt: null,
    createdAt: 0,
    updatedAt: 0,
    subtaskCount: 0,
    subtasksDone: 0,
    labelIds: [],
    hasMissingFile: false,
    ...overrides,
  };
}

const filter = (overrides: Partial<BoardFilter> = {}): BoardFilter => ({
  ...EMPTY_FILTER,
  ...overrides,
});

describe("matches", () => {
  it("keeps everything when nothing is filtered", () => {
    expect(matches(task(), EMPTY_FILTER, TODAY)).toBe(true);
  });

  it("matches text against the title, case-insensitively", () => {
    expect(matches(task(), filter({ text: "RELEASE" }), TODAY)).toBe(true);
    expect(matches(task(), filter({ text: "migration" }), TODAY)).toBe(false);
  });

  it("matches text against the description too", () => {
    const described = task({ description: "Depends on the pericardium diagram" });
    expect(matches(described, filter({ text: "pericardium" }), TODAY)).toBe(true);
  });

  it("ignores surrounding whitespace in the text", () => {
    expect(matches(task(), filter({ text: "  release  " }), TODAY)).toBe(true);
  });

  it("filters by column", () => {
    expect(matches(task(), filter({ columnIds: ["todo"] }), TODAY)).toBe(true);
    expect(matches(task(), filter({ columnIds: ["doing"] }), TODAY)).toBe(false);
  });

  it("filters by priority, including None", () => {
    expect(matches(task({ priority: 0 }), filter({ priorities: [0] }), TODAY)).toBe(true);
    expect(matches(task({ priority: 3 }), filter({ priorities: [0] }), TODAY)).toBe(false);
  });

  it("treats several values in one facet as OR", () => {
    const urgent = task({ priority: 4 });
    expect(matches(urgent, filter({ priorities: [3, 4] }), TODAY)).toBe(true);
  });

  it("treats different facets as AND", () => {
    const urgentInTodo = task({ priority: 4, columnId: "todo" });

    expect(matches(urgentInTodo, filter({ priorities: [4], columnIds: ["todo"] }), TODAY)).toBe(
      true,
    );
    expect(matches(urgentInTodo, filter({ priorities: [4], columnIds: ["doing"] }), TODAY)).toBe(
      false,
    );
  });

  it("matches a task carrying any of the chosen labels", () => {
    const tagged = task({ labelIds: ["blocked", "chore"] });

    expect(matches(tagged, filter({ labelIds: ["chore"] }), TODAY)).toBe(true);
    expect(matches(tagged, filter({ labelIds: ["urgent"] }), TODAY)).toBe(false);
    expect(matches(tagged, filter({ labelIds: ["urgent", "blocked"] }), TODAY)).toBe(true);
  });

  it("filters by due-date state", () => {
    const overdue = task({ dueDate: "2026-07-01" });
    const undated = task({ dueDate: null });

    expect(matches(overdue, filter({ due: ["overdue"] }), TODAY)).toBe(true);
    expect(matches(overdue, filter({ due: ["today"] }), TODAY)).toBe(false);
    expect(matches(undated, filter({ due: ["none"] }), TODAY)).toBe(true);
  });

  it("uses the date it is given, so the board agrees with itself", () => {
    const due = task({ dueDate: "2026-07-30" });

    expect(matches(due, filter({ due: ["today"] }), "2026-07-30")).toBe(true);
    expect(matches(due, filter({ due: ["overdue"] }), "2026-07-31")).toBe(true);
  });
});

describe("activeFacetCount", () => {
  it("counts facets, not values", () => {
    expect(activeFacetCount(EMPTY_FILTER)).toBe(0);
    expect(activeFacetCount(filter({ priorities: [1, 2, 3] }))).toBe(1);
    expect(activeFacetCount(filter({ priorities: [1], labelIds: ["a"], text: "x" }))).toBe(3);
  });

  it("does not count whitespace as text", () => {
    expect(activeFacetCount(filter({ text: "   " }))).toBe(0);
    expect(isFiltering(filter({ text: "   " }))).toBe(false);
  });
});

describe("toggle", () => {
  it("adds a missing value and removes a present one", () => {
    expect(toggle(["a"], "b")).toEqual(["a", "b"]);
    expect(toggle(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("parseFilter", () => {
  it("reads a filter it wrote", () => {
    const original = filter({ text: "x", priorities: [2], labelIds: ["l1"], due: ["overdue"] });
    expect(parseFilter(JSON.parse(JSON.stringify(original)))).toEqual(original);
  });

  it("falls back to no filter rather than throwing on rubbish", () => {
    for (const raw of [null, undefined, 42, "text", [], { text: 5 }]) {
      expect(() => parseFilter(raw)).not.toThrow();
    }
    expect(parseFilter(null)).toEqual(EMPTY_FILTER);
    expect(parseFilter({ text: 5 })).toEqual(EMPTY_FILTER);
  });

  it("drops values it does not recognise instead of keeping them", () => {
    // A filter stored by a future version must not resurrect a facet this one
    // cannot honour — it would silently hide tasks.
    const parsed = parseFilter({
      priorities: [2, 9, "high"],
      due: ["overdue", "someday"],
      labelIds: ["l1", 7],
    });

    expect(parsed.priorities).toEqual([2]);
    expect(parsed.due).toEqual(["overdue"]);
    expect(parsed.labelIds).toEqual(["l1"]);
  });
});
