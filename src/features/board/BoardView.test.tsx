import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BoardSnapshot } from "@/lib/bindings/BoardSnapshot";
import { Toaster } from "@/components/ui/Toaster";
import { useToastStore } from "@/app/toast";
import { ipc } from "@/lib/ipc";
import { renderWithProviders } from "@/test/render";

import { BoardView } from "./BoardView";

/** The board and the notification area it reports failures through. */
function renderBoard() {
  return renderWithProviders(
    <>
      <BoardView
        boardId="b1"
        projectId="p1"
        projectPrefix="TKB"
        projectName="Atticus"
        boardName="Roadmap"
      />
      <Toaster />
    </>,
  );
}

vi.mock("@/lib/ipc", () => ({
  ipc: {
    boardLoad: vi.fn(),
    taskMove: vi.fn(),
    columnTaskCount: vi.fn(),
    undoAvailable: vi.fn(),
    uiStateGet: vi.fn(),
    uiStateSet: vi.fn(),
    savedFiltersList: vi.fn(),
  },
}));

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
  tasks: [
    {
      id: "t1",
      projectId: "p1",
      boardId: "b1",
      columnId: "todo",
      number: 1,
      title: "Only task",
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
    },
  ],
  labels: [],
  archivedCount: 0,
};

const boardLoad = vi.mocked(ipc.boardLoad);
const taskMove = vi.mocked(ipc.taskMove);
const undoAvailable = vi.mocked(ipc.undoAvailable);

beforeEach(() => {
  vi.clearAllMocks();
  useToastStore.setState({ toasts: [] });
  boardLoad.mockResolvedValue(structuredClone(snapshot));
  undoAvailable.mockResolvedValue(false);
  vi.mocked(ipc.uiStateGet).mockResolvedValue(null);
  vi.mocked(ipc.uiStateSet).mockResolvedValue(null);
  vi.mocked(ipc.savedFiltersList).mockResolvedValue([]);
});

async function moveOnlyTaskToDoing() {
  const user = userEvent.setup();
  await screen.findByText("Only task");

  await user.click(screen.getByRole("button", { name: "Actions for Only task" }));
  await user.click(screen.getByRole("menuitem", { name: "Doing" }));
  return user;
}

function columnNamed(name: string) {
  return screen.getByRole("region", { name });
}

describe("BoardView move failures", () => {
  it("puts the card back and says why when the move is refused", async () => {
    // The rollback is the point. An optimistic update with no rollback shows a
    // board that disagrees with the database until something happens to refetch
    // it — which is worse than not moving the card at all.
    taskMove.mockRejectedValue({
      kind: "conflict",
      message: "A task can only move between columns on its own board.",
    });

    renderBoard();
    await moveOnlyTaskToDoing();

    await waitFor(() => {
      expect(within(columnNamed("Todo")).getByText("Only task")).toBeInTheDocument();
    });
    expect(within(columnNamed("Doing")).queryByText("Only task")).not.toBeInTheDocument();

    // Named, so the message identifies which card failed rather than saying
    // something went wrong somewhere.
    expect(await screen.findByText(/“Only task” could not be moved/)).toBeInTheDocument();
  });

  it("shows the card in its new column while the move is in flight", async () => {
    let settle!: () => void;
    taskMove.mockReturnValue(
      new Promise((resolve) => {
        settle = () => {
          resolve({
            result: {
              task: { ...snapshot.tasks[0]!, columnId: "doing", position: 0 },
              changed: true,
              columns: [
                { columnId: "todo", taskIds: [] },
                { columnId: "doing", taskIds: ["t1"] },
              ],
            },
            undo: null,
          });
        };
      }),
    );

    renderBoard();
    await moveOnlyTaskToDoing();

    // Optimistic: already in Doing before the command has answered.
    await waitFor(() => {
      expect(within(columnNamed("Doing")).getByText("Only task")).toBeInTheDocument();
    });

    settle();

    await waitFor(() => {
      expect(within(columnNamed("Doing")).getByText("Only task")).toBeInTheDocument();
    });
  });

  it("reports a board that will not load, with a way to retry", async () => {
    boardLoad.mockRejectedValue({ kind: "database", message: "disk is unreadable" });

    renderBoard();

    expect(await screen.findByText("This board could not be loaded")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
