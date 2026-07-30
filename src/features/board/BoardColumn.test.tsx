import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Column } from "@/lib/bindings/Column";
import type { BoardTask } from "@/lib/bindings/BoardTask";
import { renderWithProviders } from "@/test/render";

import { BoardColumn } from "./BoardColumn";

function column(overrides: Partial<Column> = {}): Column {
  return {
    id: "c1",
    boardId: "b1",
    name: "In Progress",
    wipLimit: null,
    position: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function task(
  id: string,
  title: string,
  number: number,
  overrides: Partial<BoardTask> = {},
): BoardTask {
  return {
    id,
    projectId: "p1",
    boardId: "b1",
    columnId: "c1",
    number,
    title,
    description: "",
    priority: 0,
    dueDate: null,
    estimateMinutes: null,
    position: number - 1,
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

function setup(overrides: Partial<React.ComponentProps<typeof BoardColumn>> = {}) {
  const handlers = {
    onCreateTask: vi.fn(),
    onOpenTask: vi.fn(),
    onNudgeTask: vi.fn(),
    onMoveTaskToColumn: vi.fn(),
    onEditColumn: vi.fn(),
    onMoveColumn: vi.fn(),
    onDeleteColumn: vi.fn(),
    onRenameTask: vi.fn(),
    onDuplicateTask: vi.fn(),
    onArchiveTask: vi.fn(),
    onDeleteTask: vi.fn(),
  };

  const view = renderWithProviders(
    <BoardColumn
      column={column()}
      tasks={[]}
      projectPrefix="TKB"
      canDelete
      canMoveLeft
      canMoveRight
      otherColumns={[]}
      labels={[]}
      today="2026-07-30"
      {...handlers}
      {...overrides}
    />,
  );

  return { ...handlers, user: userEvent.setup(), rerender: view.rerender };
}

describe("BoardColumn", () => {
  it("shows a plain count when there is no limit", () => {
    setup({ tasks: [task("t1", "One", 1)] });
    expect(screen.getByRole("region", { name: "In Progress" })).toHaveTextContent("1");
  });

  it("shows count over limit when a limit is set", () => {
    setup({ column: column({ wipLimit: 5 }), tasks: [task("t1", "One", 1)] });
    expect(screen.getByText("1/5")).toBeInTheDocument();
  });

  it("announces a breached limit rather than only colouring it", () => {
    setup({
      column: column({ wipLimit: 1 }),
      tasks: [task("t1", "One", 1), task("t2", "Two", 2)],
    });

    expect(screen.getByRole("status")).toHaveTextContent("In Progress is over its limit, 2 of 1");
  });

  it("does not announce anything while within the limit", () => {
    setup({ column: column({ wipLimit: 3 }), tasks: [task("t1", "One", 1)] });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("creates a task from a title alone", async () => {
    const { onCreateTask, user } = setup();

    await user.click(screen.getByRole("button", { name: "Add a task" }));
    await user.type(screen.getByLabelText("New task in In Progress"), "Write the spec");
    await user.keyboard("{Enter}");

    expect(onCreateTask).toHaveBeenCalledWith("c1", "Write the spec");
  });

  it("stays open after Enter so the next task can be typed", async () => {
    const { user } = setup();

    await user.click(screen.getByRole("button", { name: "Add a task" }));
    const box = screen.getByLabelText("New task in In Progress");
    await user.type(box, "First{Enter}");

    expect(box).toHaveValue("");
    expect(box).toHaveFocus();
  });

  it("treats an empty title as nothing to do, not as an error", async () => {
    const { onCreateTask, user } = setup();

    await user.click(screen.getByRole("button", { name: "Add a task" }));
    await user.keyboard("   {Enter}");

    expect(onCreateTask).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("returns focus to the button that opened the composer when Escape closes it", async () => {
    const { user } = setup();

    const addButton = screen.getByRole("button", { name: "Add a task to In Progress" });
    await user.click(addButton);
    await user.keyboard("{Escape}");

    expect(addButton).toHaveFocus();
  });

  it("explains why the delete action is unavailable on a board's last column", async () => {
    const { onDeleteColumn, user } = setup({ canDelete: false });

    await user.click(screen.getByRole("button", { name: "Actions for In Progress" }));

    expect(screen.getByText("A board needs at least one column.")).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: /Delete column/ }));
    expect(onDeleteColumn).not.toHaveBeenCalled();
  });

  it("offers a task's actions by name", async () => {
    const { onDuplicateTask, onArchiveTask, onDeleteTask, user } = setup({
      tasks: [task("t1", "Write the spec", 1)],
    });

    await user.click(screen.getByRole("button", { name: "Actions for Write the spec" }));
    await user.click(screen.getByRole("menuitem", { name: "Duplicate" }));
    expect(onDuplicateTask).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Actions for Write the spec" }));
    await user.click(screen.getByRole("menuitem", { name: "Archive" }));
    expect(onArchiveTask).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Actions for Write the spec" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(onDeleteTask).toHaveBeenCalledOnce();
  });

  it("shows each task's project-scoped reference", () => {
    setup({ tasks: [task("t1", "Write the spec", 14)] });

    const list = screen.getByRole("list");
    expect(within(list).getByText("TKB-14")).toBeInTheDocument();
  });

  it("keeps a very long title readable rather than letting it overflow", () => {
    const long = "Supercalifragilistic ".repeat(30).trim();
    setup({ tasks: [task("t1", long, 1)] });

    const title = screen.getByTitle(long);
    expect(title).toHaveClass("line-clamp-3");
    expect(title).toHaveClass("break-words");
  });

  it("moves a column with a keyboard-reachable command", async () => {
    const { onMoveColumn, user } = setup();

    await user.click(screen.getByRole("button", { name: "Actions for In Progress" }));
    await user.click(screen.getByRole("menuitem", { name: "Move right" }));

    expect(onMoveColumn).toHaveBeenCalledWith(expect.objectContaining({ id: "c1" }), 1);
  });

  it("does not offer to move a column past the end of the board", async () => {
    const { user } = setup({ canMoveLeft: false, canMoveRight: false });

    await user.click(screen.getByRole("button", { name: "Actions for In Progress" }));

    expect(screen.getByRole("menuitem", { name: "Move left" })).toHaveAttribute("data-disabled");
    expect(screen.getByRole("menuitem", { name: "Move right" })).toHaveAttribute("data-disabled");
  });

  it("shows a task's priority with a word, not only a colour", () => {
    setup({ tasks: [task("t1", "Urgent thing", 1, { priority: 4 })] });
    expect(screen.getByText("Urgent")).toBeInTheDocument();
  });

  it("shows no priority chip for the default level", () => {
    setup({ tasks: [task("t1", "Ordinary", 1, { priority: 0 })] });
    expect(screen.queryByText("None")).not.toBeInTheDocument();
  });

  it("shows a subtask count only when there are subtasks", () => {
    setup({
      tasks: [
        task("t1", "With steps", 1, { subtaskCount: 5, subtasksDone: 2 }),
        task("t2", "Without", 2),
      ],
    });

    expect(screen.getByText("2/5")).toBeInTheDocument();
    expect(
      screen.getByLabelText("2 of 5 subtasks done"),
      "the count needs a spoken form too",
    ).toBeInTheDocument();
    expect(screen.queryByText("0/0")).not.toBeInTheDocument();
  });

  it("shows at most three labels and collapses the rest", () => {
    const labels = ["one", "two", "three", "four", "five"].map((name, index) => ({
      id: `l${String(index)}`,
      projectId: "p1",
      name,
      color: "red",
      createdAt: 0,
      updatedAt: 0,
    }));

    setup({
      labels,
      tasks: [task("t1", "Tagged", 1, { labelIds: labels.map((label) => label.id) })],
    });

    expect(screen.getByText("one")).toBeInTheDocument();
    expect(screen.getByText("three")).toBeInTheDocument();
    expect(screen.queryByText("four")).not.toBeInTheDocument();
    // The hidden ones are named, not merely counted.
    expect(screen.getByLabelText("and 2 more: four, five")).toBeInTheDocument();
  });

  it("flags a task whose linked file has gone missing", () => {
    setup({ tasks: [task("t1", "Has a broken link", 1, { hasMissingFile: true })] });
    expect(screen.getByText("Missing file")).toBeInTheDocument();
  });

  it("opens the editor from the task menu", async () => {
    const { onOpenTask, user } = setup({ tasks: [task("t1", "Write the spec", 1)] });

    await user.click(screen.getByRole("button", { name: "Actions for Write the spec" }));
    await user.click(screen.getByRole("menuitem", { name: "Open" }));

    expect(onOpenTask).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }));
  });

  it("opens the editor by clicking the card itself", async () => {
    // The obvious gesture. It did nothing at first, because the whole card was
    // the drag target and the menu was the only way in.
    const { onOpenTask, user } = setup({ tasks: [task("t1", "Write the spec", 1)] });

    // Anchored: "Drag Write the spec" and "Actions for Write the spec" are
    // buttons too. The card's own name is its content, which starts with the
    // title — deliberately, so a screen reader reads the metadata as well.
    await user.click(screen.getByRole("button", { name: /^Write the spec/ }));

    expect(onOpenTask).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }));
  });

  it("opens the editor from the keyboard, without reaching for a menu", async () => {
    const { onOpenTask, user } = setup({ tasks: [task("t1", "Write the spec", 1)] });

    screen.getByRole("button", { name: /^Write the spec/ }).focus();
    await user.keyboard("{Enter}");

    expect(onOpenTask).toHaveBeenCalledOnce();
  });

  it("keeps dragging on its own handle, so it cannot swallow a click", async () => {
    const { onOpenTask, user } = setup({ tasks: [task("t1", "Write the spec", 1)] });

    const handle = screen.getByRole("button", { name: "Drag Write the spec" });
    expect(handle).toBeInTheDocument();

    await user.click(handle);
    expect(onOpenTask).not.toHaveBeenCalled();
  });

  it("shows an overdue task as overdue, in words", () => {
    setup({
      today: "2026-07-30",
      tasks: [task("t1", "Late", 1, { dueDate: "2026-07-28" })],
    });

    expect(screen.getByText("Overdue by 2 days")).toBeInTheDocument();
  });

  it("re-reads today's date rather than baking it in at first render", () => {
    // US-16 AC3. A board left open overnight must stop calling yesterday
    // "today"; the date is a prop so every card changes together.
    const due = "2026-07-30";

    const { rerender } = setup({ today: due, tasks: [task("t1", "Soon", 1, { dueDate: due })] });
    expect(screen.getByText("Due today")).toBeInTheDocument();

    rerender(
      <BoardColumn
        column={column()}
        tasks={[task("t1", "Soon", 1, { dueDate: due })]}
        projectPrefix="TKB"
        canDelete
        canMoveLeft
        canMoveRight
        otherColumns={[]}
        labels={[]}
        today="2026-07-31"
        onCreateTask={vi.fn()}
        onOpenTask={vi.fn()}
        onNudgeTask={vi.fn()}
        onMoveTaskToColumn={vi.fn()}
        onEditColumn={vi.fn()}
        onMoveColumn={vi.fn()}
        onDeleteColumn={vi.fn()}
        onRenameTask={vi.fn()}
        onDuplicateTask={vi.fn()}
        onArchiveTask={vi.fn()}
        onDeleteTask={vi.fn()}
      />,
    );

    expect(screen.getByText("Overdue by 1 day")).toBeInTheDocument();
  });
});
