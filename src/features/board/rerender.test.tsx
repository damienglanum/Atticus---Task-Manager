/**
 * Product-spec §9: "Typing in the task editor — 0 re-renders of any column or
 * card component."
 *
 * The target exists because the editor sits inside the board's React tree. If a
 * keystroke reached board state or the query cache, every card on screen would
 * re-render on every character, and on a busy board that is the difference
 * between an editor that types and one that stutters.
 *
 * `TaskCard` is not wrapped in `React.memo` — design-decisions §9 says
 * memoisation is added only when a measurement shows a target is missed — so
 * nothing structurally prevents this. It has to be measured.
 *
 * Measured by counting renders of the **real** card: the module is mocked with a
 * wrapper that increments a counter and then delegates. A `<Profiler>` cannot
 * answer this on its own, because the editor is in the same React tree and a
 * commit for the dialog fires the profiler for the whole subtree.
 */
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BoardSnapshot } from "@/lib/bindings/BoardSnapshot";
import type { TaskDetail } from "@/lib/bindings/TaskDetail";
import { ipc } from "@/lib/ipc";
import { renderWithProviders } from "@/test/render";

import { BoardView } from "./BoardView";
import type * as TaskCardModule from "./TaskCard";

const cardRenders = { count: 0 };

vi.mock("./TaskCard", async (importOriginal) => {
  const actual = await importOriginal<typeof TaskCardModule>();
  return {
    ...actual,
    TaskCard: (props: Parameters<typeof actual.TaskCard>[0]) => {
      cardRenders.count += 1;
      return createElement(actual.TaskCard, props);
    },
  };
});

vi.mock("@/lib/ipc", () => ({
  ipc: {
    boardLoad: vi.fn(),
    taskMove: vi.fn(),
    columnTaskCount: vi.fn(),
    undoAvailable: vi.fn(),
    uiStateGet: vi.fn(),
    uiStateSet: vi.fn(),
    savedFiltersList: vi.fn(),
    taskDetail: vi.fn(),
    taskUpdate: vi.fn(),
    labelsList: vi.fn(),
    subtaskCreate: vi.fn(),
    subtaskUpdate: vi.fn(),
    subtaskDelete: vi.fn(),
    taskSetLabels: vi.fn(),
    labelCreate: vi.fn(),
    fileRefAdd: vi.fn(),
    fileRefRelocate: vi.fn(),
    fileRefRemove: vi.fn(),
    fileRefReveal: vi.fn(),
    pickFile: vi.fn(),
  },
}));

/** Several cards, because one card cannot show a per-card cost. */
const snapshot: BoardSnapshot = {
  boardId: "b1",
  columns: [
    {
      id: "todo",
      boardId: "b1",
      name: "Todo",
      wipLimit: null,
      position: 0,
      createdAt: 0,
      updatedAt: 0,
    },
    {
      id: "doing",
      boardId: "b1",
      name: "Doing",
      wipLimit: null,
      position: 1,
      createdAt: 0,
      updatedAt: 0,
    },
  ],
  tasks: Array.from({ length: 6 }, (_, index) => ({
    id: `t${String(index + 1)}`,
    projectId: "p1",
    boardId: "b1",
    columnId: index % 2 === 0 ? "todo" : "doing",
    number: index + 1,
    title: `Task ${String(index + 1)}`,
    description: "",
    priority: 0,
    dueDate: null,
    estimateMinutes: null,
    position: Math.floor(index / 2),
    archivedAt: null,
    createdAt: 0,
    updatedAt: 0,
    subtaskCount: 0,
    subtasksDone: 0,
    labelIds: [],
    hasMissingFile: false,
  })),
  labels: [],
  archivedCount: 0,
};

const detail: TaskDetail = {
  task: { ...snapshot.tasks[0]!, description: "" },
  subtasks: [],
  labelIds: [],
  fileRefs: [],
  availableLabels: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  cardRenders.count = 0;
  vi.mocked(ipc.boardLoad).mockResolvedValue(structuredClone(snapshot));
  vi.mocked(ipc.undoAvailable).mockResolvedValue(false);
  vi.mocked(ipc.uiStateGet).mockResolvedValue(null);
  vi.mocked(ipc.uiStateSet).mockResolvedValue(null);
  vi.mocked(ipc.savedFiltersList).mockResolvedValue([]);
  vi.mocked(ipc.labelsList).mockResolvedValue([]);
  vi.mocked(ipc.taskDetail).mockResolvedValue(structuredClone(detail));
  // `taskUpdate` resolves to a Task, not the whole detail.
  vi.mocked(ipc.taskUpdate).mockResolvedValue(structuredClone(detail.task));
});

describe("typing in the task editor", () => {
  it("re-renders no card at all", async () => {
    const user = userEvent.setup();
    renderWithProviders(<BoardView boardId="b1" projectId="p1" projectPrefix="TKB" />);

    await screen.findByText("Task 1");
    // Anchored: the card button's accessible name is its whole text — the title
    // plus the reference line — so an exact match on the title finds nothing,
    // and an unanchored one also matches "Actions for Task 1" and "Drag Task 1".
    await user.click(screen.getByRole("button", { name: /^Task 1\b/ }));

    const description = await screen.findByLabelText("Edit description");

    // Counted from here: opening the editor is allowed to cost renders, and
    // conflating the two would let a per-keystroke re-render hide inside the
    // cost of opening.
    const before = cardRenders.count;
    await user.type(description, "a description typed one character at a time");
    const during = cardRenders.count - before;

    // Printed as well as asserted, so a regression says how bad it is rather
    // than only that it happened.
    console.log(
      `typing ${String("a description typed one character at a time".length)} characters ` +
        `caused ${String(during)} card renders (target 0, board has ${String(snapshot.tasks.length)} cards)`,
    );

    expect(during).toBe(0);
  });

  it("still re-renders cards when the board data actually changes", async () => {
    // The control. Without it, a broken counter — a mock that never wired up, a
    // card that never rendered — would make the assertion above pass for the
    // wrong reason, which is the failure mode a zero-count test invites.
    const user = userEvent.setup();
    renderWithProviders(<BoardView boardId="b1" projectId="p1" projectPrefix="TKB" />);

    await screen.findByText("Task 1");
    const before = cardRenders.count;
    expect(before).toBeGreaterThan(0);

    await user.type(screen.getByLabelText("Filter tasks on this board"), "Task 1");

    expect(cardRenders.count).toBeGreaterThan(before);
  });
});
