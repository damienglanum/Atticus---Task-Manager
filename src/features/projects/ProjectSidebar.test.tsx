import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Board } from "@/lib/bindings/Board";
import type { Project } from "@/lib/bindings/Project";
import { ProjectSidebar } from "./ProjectSidebar";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "p1",
    name: "Takenkanban",
    description: "",
    color: "indigo",
    keyPrefix: "TAK",
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

function makeBoard(overrides: Partial<Board> = {}): Board {
  return {
    id: "b1",
    projectId: "ai-1",
    name: "Agent work",
    position: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function setup(props: Partial<Parameters<typeof ProjectSidebar>[0]> = {}) {
  const handlers = {
    onSelect: vi.fn(),
    onSelectMcpBoard: vi.fn(),
    onCreate: vi.fn(),
    onEdit: vi.fn(),
    onArchive: vi.fn(),
    onDelete: vi.fn(),
    onOpenSettings: vi.fn(),
    onNavigate: vi.fn(),
    onRenameProfile: vi.fn(),
  };
  render(
    <ProjectSidebar
      active={[]}
      archived={[]}
      mcpProjects={[]}
      mcpBoards={[]}
      selectedId={null}
      selectedBoardId={null}
      view="board"
      profileName="Ada Lovelace"
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe("ProjectSidebar", () => {
  it("explains what a project is when there are none", () => {
    setup();

    expect(screen.getByText("No projects yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create your first project" })).toBeInTheDocument();
  });

  it("gives the two ways to create a project distinct names", () => {
    setup();

    // Exact-name lookups: two controls announcing "New project" would be a real
    // problem for voice control, and this is what would catch it.
    expect(screen.getByRole("button", { name: "New project" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create your first project" })).toBeInTheDocument();
  });

  it("marks the open project as current", () => {
    const active = [makeProject(), makeProject({ id: "p2", name: "Other" })];
    setup({ active, selectedId: "p2" });

    expect(screen.getByRole("button", { name: "Other" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "Takenkanban" })).not.toHaveAttribute("aria-current");
  });

  it("hides archived projects behind a collapsed section", async () => {
    const archived = [makeProject({ id: "p9", name: "Shelved", archivedAt: 1 })];
    setup({ archived });

    expect(screen.queryByRole("button", { name: "Shelved" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Archived/ }));

    expect(screen.getByRole("button", { name: "Shelved" })).toBeInTheDocument();
  });

  it("keeps AI boards in a dedicated collapsible protected section", async () => {
    const project = makeProject({
      id: "ai-1",
      name: "Release agent",
      keyPrefix: "AI",
      mcpManaged: true,
    });
    setup({ mcpProjects: [project], mcpBoards: [makeBoard()] });

    expect(screen.getByText("AI can write here only. Your projects stay protected.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Agent work in Release agent" })).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: /AI Boards/ }));

    expect(
      screen.queryByRole("button", { name: "Agent work in Release agent" }),
    ).not.toBeInTheDocument();
  });

  it("opens an AI board from its isolated section", async () => {
    const board = makeBoard();
    const handlers = setup({
      mcpProjects: [makeProject({ id: "ai-1", name: "Release agent", mcpManaged: true })],
      mcpBoards: [board],
    });

    await userEvent.click(screen.getByRole("button", { name: "Agent work in Release agent" }));

    expect(handlers.onSelectMcpBoard).toHaveBeenCalledExactlyOnceWith(board);
  });

  it("does not show an archived section when nothing is archived", () => {
    setup({ active: [makeProject()] });

    expect(screen.queryByRole("button", { name: /Archived/ })).not.toBeInTheDocument();
  });

  it("warns when a project's directory has gone missing", () => {
    setup({ active: [makeProject({ directoryPath: "/gone", directoryMissing: true })] });

    expect(screen.getByLabelText("Project directory is missing")).toBeInTheDocument();
  });

  it("offers archive for an active project and restore for an archived one", async () => {
    const archived = [makeProject({ id: "p9", name: "Shelved", archivedAt: 1 })];
    const handlers = setup({ active: [makeProject()], archived });

    await userEvent.click(screen.getByRole("button", { name: "Actions for Takenkanban" }));
    expect(screen.getByRole("menuitem", { name: /Archive project/ })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");

    await userEvent.click(screen.getByRole("button", { name: /Archived/ }));
    await userEvent.click(screen.getByRole("button", { name: "Actions for Shelved" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /Restore project/ }));

    expect(handlers.onArchive).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: "p9" }),
      false,
    );
  });

  it("routes delete through the caller rather than acting immediately", async () => {
    const handlers = setup({ active: [makeProject()] });

    await userEvent.click(screen.getByRole("button", { name: "Actions for Takenkanban" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /Delete project/ }));

    expect(handlers.onDelete).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: "p1" }),
    );
  });

  it("gives every icon-only control an accessible name", () => {
    setup({ active: [makeProject()] });

    expect(screen.getByRole("button", { name: "New project" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Actions for Takenkanban" })).toBeInTheDocument();
  });
});
