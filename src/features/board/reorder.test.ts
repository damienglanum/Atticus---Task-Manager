import { describe, expect, it } from "vitest";

import type { BoardSnapshot } from "@/lib/bindings/BoardSnapshot";
import type { Column } from "@/lib/bindings/Column";
import type { BoardTask } from "@/lib/bindings/BoardTask";

import { applyColumnOrders, applyMove, dropTarget, tasksInColumn } from "./reorder";

function column(id: string, position: number): Column {
  return {
    id,
    boardId: "b1",
    name: id,
    wipLimit: null,
    position,
    createdAt: 0,
    updatedAt: 0,
  };
}

function task(id: string, columnId: string, position: number): BoardTask {
  return {
    id,
    projectId: "p1",
    boardId: "b1",
    columnId,
    number: 1,
    title: id,
    description: "",
    priority: 0,
    dueDate: null,
    estimateMinutes: null,
    position,
    archivedAt: null,
    createdAt: 0,
    updatedAt: 0,
    subtaskCount: 0,
    subtasksDone: 0,
    labelIds: [],
    hasMissingFile: false,
  };
}

/** Todo holds a, b, c; Doing holds d; Done is empty. */
function board(): BoardSnapshot {
  return {
    boardId: "b1",
    columns: [column("todo", 0), column("doing", 1), column("done", 2)],
    tasks: [
      task("a", "todo", 0),
      task("b", "todo", 1),
      task("c", "todo", 2),
      task("d", "doing", 0),
    ],
    labels: [],
    archivedCount: 0,
  };
}

const idsIn = (snapshot: BoardSnapshot, columnId: string) =>
  tasksInColumn(snapshot, columnId).map((each) => each.id);

describe("applyMove", () => {
  it("reorders within a column", () => {
    const after = applyMove(board(), "c", "todo", 0);
    expect(idsIn(after, "todo")).toEqual(["c", "a", "b"]);
  });

  it("keeps positions dense after a within-column move", () => {
    const after = applyMove(board(), "a", "todo", 2);
    expect(tasksInColumn(after, "todo").map((each) => each.position)).toEqual([0, 1, 2]);
  });

  it("moves between columns and closes the gap behind", () => {
    const after = applyMove(board(), "b", "doing", 0);

    expect(idsIn(after, "todo")).toEqual(["a", "c"]);
    expect(idsIn(after, "doing")).toEqual(["b", "d"]);
    expect(tasksInColumn(after, "todo").map((each) => each.position)).toEqual([0, 1]);
    expect(tasksInColumn(after, "doing").map((each) => each.position)).toEqual([0, 1]);
  });

  it("moves into an empty column", () => {
    const after = applyMove(board(), "a", "done", 0);

    expect(idsIn(after, "done")).toEqual(["a"]);
    expect(idsIn(after, "todo")).toEqual(["b", "c"]);
  });

  it("clamps an index past the end to the end", () => {
    const after = applyMove(board(), "a", "todo", 99);
    expect(idsIn(after, "todo")).toEqual(["b", "c", "a"]);
  });

  it("clamps a negative index to the start", () => {
    const after = applyMove(board(), "c", "todo", -5);
    expect(idsIn(after, "todo")).toEqual(["c", "a", "b"]);
  });

  it("leaves the board alone when the task does not exist", () => {
    const before = board();
    expect(applyMove(before, "ghost", "todo", 0)).toBe(before);
  });

  it("is a no-op when the task is already at that index", () => {
    const after = applyMove(board(), "b", "todo", 1);
    expect(idsIn(after, "todo")).toEqual(["a", "b", "c"]);
  });

  it("moves the first task to last and back", () => {
    const toEnd = applyMove(board(), "a", "todo", 2);
    expect(idsIn(toEnd, "todo")).toEqual(["b", "c", "a"]);

    const andBack = applyMove(toEnd, "a", "todo", 0);
    expect(idsIn(andBack, "todo")).toEqual(["a", "b", "c"]);
  });
});

describe("applyColumnOrders", () => {
  it("rewrites the order to what the backend reported", () => {
    const after = applyColumnOrders(board(), [
      { columnId: "todo", taskIds: ["c", "b", "a"] },
      { columnId: "doing", taskIds: ["d"] },
    ]);

    expect(idsIn(after, "todo")).toEqual(["c", "b", "a"]);
    expect(tasksInColumn(after, "todo").map((each) => each.position)).toEqual([0, 1, 2]);
  });

  it("moves a task that the backend says changed column", () => {
    const after = applyColumnOrders(board(), [
      { columnId: "todo", taskIds: ["a", "c"] },
      { columnId: "doing", taskIds: ["d", "b"] },
    ]);

    expect(idsIn(after, "doing")).toEqual(["d", "b"]);
    expect(idsIn(after, "todo")).toEqual(["a", "c"]);
  });

  it("leaves columns it was not told about untouched", () => {
    const after = applyColumnOrders(board(), [{ columnId: "todo", taskIds: ["a", "b", "c"] }]);
    expect(idsIn(after, "doing")).toEqual(["d"]);
  });
});

describe("dropTarget", () => {
  it("drops onto a task in another column at that task's index", () => {
    expect(dropTarget(board(), "a", "d")).toEqual({ columnId: "doing", index: 0 });
  });

  it("drops onto a task in the same column at that task's index", () => {
    expect(dropTarget(board(), "a", "c")).toEqual({ columnId: "todo", index: 2 });
  });

  it("drops onto an empty column at index zero", () => {
    expect(dropTarget(board(), "a", "done")).toEqual({ columnId: "done", index: 0 });
  });

  it("drops onto another column's empty area at the end", () => {
    expect(dropTarget(board(), "a", "doing")).toEqual({ columnId: "doing", index: 1 });
  });

  it("drops onto its own column's empty area at the end", () => {
    // The task has vacated its own slot, so "the end" is one less than the
    // column's current length — otherwise this reads as a move past the end.
    expect(dropTarget(board(), "a", "todo")).toEqual({ columnId: "todo", index: 2 });
  });

  it("returns nothing for an unknown target", () => {
    expect(dropTarget(board(), "a", "nowhere")).toBeNull();
    expect(dropTarget(board(), "ghost", "todo")).toBeNull();
  });
});
