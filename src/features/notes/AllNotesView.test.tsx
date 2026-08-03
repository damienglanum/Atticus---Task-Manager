import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Note } from "@/lib/bindings/Note";
import type { NoteIndexItem } from "@/lib/bindings/NoteIndexItem";
import type { Project } from "@/lib/bindings/Project";
import { ipc } from "@/lib/ipc";
import { renderWithProviders } from "@/test/render";

import { AllNotesView } from "./AllNotesView";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    notesListAll: vi.fn(),
    notesList: vi.fn(),
    boardsList: vi.fn(),
    noteCreate: vi.fn(),
    noteUpdate: vi.fn(),
    noteDelete: vi.fn(),
    boardLoad: vi.fn(),
    boardArchivedTasks: vi.fn(),
    openExternal: vi.fn(),
    workspaceSet: vi.fn(),
  },
}));

const notesListAll = vi.mocked(ipc.notesListAll);
const notesList = vi.mocked(ipc.notesList);
const boardsList = vi.mocked(ipc.boardsList);
const noteCreate = vi.mocked(ipc.noteCreate);
const workspaceSet = vi.mocked(ipc.workspaceSet);

function makeProject(overrides: Partial<Project>): Project {
  return {
    id: "p1",
    name: "Alpha",
    description: "",
    color: "cyan",
    keyPrefix: "ALP",
    nextTaskNumber: 1,
    directoryPath: null,
    directoryMissing: false,
    mcpManaged: false,
    position: 0,
    archivedAt: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function makeNote(projectId: string, id: string, title: string, body: string): Note {
  return {
    id,
    projectId,
    title,
    body,
    taskIds: [],
    position: 0,
    createdAt: 1,
    updatedAt: 1,
  };
}

function indexItem(note: Note): NoteIndexItem {
  return {
    id: note.id,
    projectId: note.projectId,
    title: note.title,
    excerpt: note.body,
    position: note.position,
    updatedAt: note.updatedAt,
    taskCount: note.taskIds.length,
  };
}

const PROJECTS = [
  makeProject({}),
  makeProject({ id: "p2", name: "Beta", keyPrefix: "BET", color: "teal", position: 1 }),
];
const ALPHA_NOTE = makeNote("p1", "n1", "Architecture plan", "# System shape");
const BETA_NOTE = makeNote("p2", "n2", "Launch brief", "# Release day");

beforeEach(() => {
  vi.clearAllMocks();
  notesListAll.mockResolvedValue([indexItem(ALPHA_NOTE), indexItem(BETA_NOTE)]);
  notesList.mockImplementation((projectId) =>
    Promise.resolve(projectId === "p1" ? [ALPHA_NOTE] : [BETA_NOTE]),
  );
  boardsList.mockResolvedValue([]);
  noteCreate.mockImplementation((projectId, title) =>
    Promise.resolve({
      ...makeNote(projectId, "new-note", title, ""),
      position: 1,
      updatedAt: 2,
    }),
  );
});

describe("AllNotesView", () => {
  it("groups notes by owner and lazily opens the selected note's project", async () => {
    const user = userEvent.setup();
    renderWithProviders(<AllNotesView projects={PROJECTS} onOpenTask={vi.fn()} />);

    const alphaGroup = await screen.findByRole("region", { name: "Alpha notes" });
    const betaGroup = screen.getByRole("region", { name: "Beta notes" });
    expect(
      within(alphaGroup).getByRole("button", { name: "Architecture plan, Alpha" }),
    ).toBeInTheDocument();
    expect(
      within(betaGroup).getByRole("button", { name: "Launch brief, Beta" }),
    ).toBeInTheDocument();

    await user.click(within(betaGroup).getByRole("button", { name: "Launch brief, Beta" }));

    const editor = await screen.findByRole("region", { name: "Note: Launch brief" });
    expect(within(editor).getByText("Beta")).toBeInTheDocument();
    expect(notesList).toHaveBeenCalledWith("p2");
    expect(boardsList).toHaveBeenCalledWith("p2");
    expect(workspaceSet).not.toHaveBeenCalled();
  });

  it("requires an explicit project choice before creating a note", async () => {
    notesListAll.mockResolvedValue([]);
    const user = userEvent.setup();
    renderWithProviders(<AllNotesView projects={PROJECTS} onOpenTask={vi.fn()} />);

    await user.click(await screen.findByRole("button", { name: "New note" }));
    expect(noteCreate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("menuitem", { name: /Beta/ }));

    await waitFor(() => {
      expect(noteCreate).toHaveBeenCalledExactlyOnceWith("p2", "Untitled note");
    });
    expect(await screen.findByDisplayValue("Untitled note")).toBeInTheDocument();
    expect(workspaceSet).not.toHaveBeenCalled();
  });
});
