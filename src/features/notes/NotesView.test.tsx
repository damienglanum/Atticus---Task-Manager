import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IDLE_PREVIEW_DELAY_MS } from "@/components/ui/useIdlePreview";
import type { Note } from "@/lib/bindings/Note";
import { ipc } from "@/lib/ipc";
import { renderWithProviders } from "@/test/render";

import { NotesView } from "./NotesView";

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

function renderNotes() {
  return renderWithProviders(
    <NotesView
      projectId="p1"
      projectName="Atticus"
      projectKeyPrefix="ATT"
      boards={[]}
      onOpenTask={vi.fn()}
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
});

/** Kept local so the production debounce can change without making this test sleep. */
const SAVE_DELAY_FOR_TEST = 500;
