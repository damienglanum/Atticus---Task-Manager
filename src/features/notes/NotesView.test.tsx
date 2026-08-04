import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IDLE_PREVIEW_DELAY_MS } from "@/components/ui/useIdlePreview";
import type { Board } from "@/lib/bindings/Board";
import type { BoardSnapshot } from "@/lib/bindings/BoardSnapshot";
import type { Note } from "@/lib/bindings/Note";
import { ipc } from "@/lib/ipc";
import { renderWithProviders } from "@/test/render";

import { NotesView } from "./NotesView";
import type { TaskTarget } from "./taskContexts";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    notesList: vi.fn(),
    noteCreate: vi.fn(),
    noteUpdate: vi.fn(),
    noteDelete: vi.fn(),
    boardLoad: vi.fn(),
    boardArchivedTasks: vi.fn(),
    openExternal: vi.fn(),
  },
}));

const notesList = vi.mocked(ipc.notesList);
const noteCreate = vi.mocked(ipc.noteCreate);
const noteUpdate = vi.mocked(ipc.noteUpdate);
const boardLoad = vi.mocked(ipc.boardLoad);
const boardArchivedTasks = vi.mocked(ipc.boardArchivedTasks);

const NOTE: Note = {
  id: "n1",
  projectId: "p1",
  title: "Release notes",
  body: "",
  taskIds: [],
  position: 0,
  createdAt: 0,
  updatedAt: 0,
};

const BOARD: Board = {
  id: "b1",
  projectId: "p1",
  name: "Roadmap",
  position: 0,
  createdAt: 0,
  updatedAt: 0,
};

const BOARD_WITH_TASK: BoardSnapshot = {
  boardId: "b1",
  columns: [
    {
      id: "doing",
      boardId: "b1",
      name: "In Progress",
      wipLimit: null,
      position: 0,
      createdAt: 0,
      updatedAt: 0,
    },
  ],
  tasks: [
    {
      id: "t1",
      projectId: "p1",
      boardId: "b1",
      columnId: "doing",
      number: 7,
      title: "Make linked work useful",
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

function renderNotes({
  boards = [],
  onOpenTask = () => undefined,
}: { boards?: Board[]; onOpenTask?: (task: TaskTarget) => void } = {}) {
  return renderWithProviders(
    <NotesView
      projectId="p1"
      projectName="Atticus"
      projectKeyPrefix="ATT"
      boards={boards}
      onOpenTask={onOpenTask}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  notesList.mockResolvedValue([NOTE]);
  noteCreate.mockResolvedValue({
    ...NOTE,
    id: "n2",
    title: "Untitled note",
    position: 1,
    createdAt: 1,
    updatedAt: 1,
  });
  noteUpdate.mockImplementation((id, _expectedUpdatedAt, patch) =>
    Promise.resolve({
      ...NOTE,
      id,
      title: patch.title ?? NOTE.title,
      body: patch.body ?? NOTE.body,
      taskIds: patch.taskIds ?? NOTE.taskIds,
      updatedAt: 1,
    }),
  );
  boardLoad.mockResolvedValue(structuredClone(BOARD_WITH_TASK));
  boardArchivedTasks.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("NotesView", () => {
  it("opens the writing surface without Markdown onboarding copy", async () => {
    renderNotes();

    expect(await screen.findByLabelText("Note body")).toHaveAttribute(
      "placeholder",
      "Start writing…",
    );
    expect(screen.queryByText("Markdown is formatted when you pause.")).not.toBeInTheDocument();
  });

  it("opens a newly created page immediately", async () => {
    renderNotes();
    await screen.findByLabelText("Note body");

    fireEvent.click(screen.getByRole("button", { name: "New note" }));

    expect(await screen.findByDisplayValue("Untitled note")).toHaveAttribute("id", "note-title");
    expect(noteCreate).toHaveBeenCalledExactlyOnceWith("p1", "Untitled note");
  });

  it("renders a note's Markdown after the author pauses", async () => {
    renderNotes();
    const body = await screen.findByLabelText("Note body");

    vi.useFakeTimers();
    fireEvent.change(body, { target: { value: "# Field report" } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(IDLE_PREVIEW_DELAY_MS);
    });

    expect(screen.getByRole("heading", { name: "Field report" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Note body")).not.toBeInTheDocument();
    expect(noteUpdate).toHaveBeenCalledWith("n1", 0, {
      title: null,
      body: "# Field report",
      taskIds: null,
    });
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("flushes a pending draft when its page is closed before the debounce", async () => {
    const view = renderNotes();
    const body = await screen.findByLabelText("Note body");

    fireEvent.change(body, { target: { value: "Do not lose this" } });
    view.unmount();

    await waitFor(() => {
      expect(noteUpdate).toHaveBeenCalledWith("n1", 0, {
        title: null,
        body: "Do not lose this",
        taskIds: null,
      });
    });
  });

  it("keeps a failed draft visibly unsaved so it can be retried", async () => {
    noteUpdate.mockRejectedValueOnce({ kind: "database", message: "disk unavailable" });
    renderNotes();
    const body = await screen.findByLabelText("Note body");

    vi.useFakeTimers();
    fireEvent.change(body, { target: { value: "A recoverable draft" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_DELAY_FOR_TEST);
    });

    expect(screen.getByText("Save failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("keeps task linking in the note properties and opens a linked task", async () => {
    const user = userEvent.setup();
    const onOpenTask = vi.fn();
    notesList.mockResolvedValue([{ ...NOTE, taskIds: ["t1"] }]);
    renderNotes({ boards: [BOARD], onOpenTask });

    const linkedTask = await screen.findByRole("button", {
      name: "Open ATT-7: Make linked work useful",
    });
    expect(screen.queryByRole("heading", { name: "Links" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("list", { name: "Tasks linked to this note" }),
    ).not.toBeInTheDocument();

    await user.click(linkedTask);
    expect(onOpenTask).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: "t1", boardId: "b1", projectId: "p1" }),
    );

    await user.click(screen.getByRole("button", { name: "Link tasks to this note" }));
    expect(
      await screen.findByRole("menuitemcheckbox", { name: /Make linked work useful/ }),
    ).toHaveAttribute("aria-checked", "true");
  });
});

/** Kept local so the production debounce can change without making this test sleep. */
const SAVE_DELAY_FOR_TEST = 500;
