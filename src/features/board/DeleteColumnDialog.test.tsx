import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Column } from "@/lib/bindings/Column";
import { renderWithProviders } from "@/test/render";

import { DeleteColumnDialog } from "./DeleteColumnDialog";

function column(id: string, name: string): Column {
  return {
    id,
    boardId: "b1",
    name,
    wipLimit: null,
    position: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

const target = column("c1", "In Progress");
const others = [column("c2", "Todo"), column("c3", "Done")];

function setup(overrides: Partial<React.ComponentProps<typeof DeleteColumnDialog>> = {}) {
  const onConfirm = vi.fn();
  renderWithProviders(
    <DeleteColumnDialog
      column={target}
      otherColumns={others}
      taskCount={0}
      countFailed={false}
      pending={false}
      onOpenChange={vi.fn()}
      onConfirm={onConfirm}
      {...overrides}
    />,
  );
  return { onConfirm, user: userEvent.setup() };
}

describe("DeleteColumnDialog", () => {
  it("asks for a simple confirmation when the column is empty", async () => {
    const { onConfirm, user } = setup();

    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete column" }));

    expect(onConfirm).toHaveBeenCalledWith({ kind: "deleteTasks" });
  });

  it("states the exact number of tasks rather than a vague warning", () => {
    setup({ taskCount: 7 });
    expect(screen.getByText("7 tasks")).toBeInTheDocument();
  });

  it("uses the singular for one task", () => {
    setup({ taskCount: 1 });
    expect(screen.getByText("1 task")).toBeInTheDocument();
  });

  it("defaults to moving the tasks, not deleting them", async () => {
    const { onConfirm, user } = setup({ taskCount: 3 });

    await user.click(screen.getByRole("button", { name: "Delete column" }));

    expect(onConfirm).toHaveBeenCalledWith({ kind: "moveTo", columnId: "c2" });
  });

  it("moves the tasks to the column the user picked", async () => {
    const { onConfirm, user } = setup({ taskCount: 3 });

    await user.selectOptions(screen.getByLabelText("Column to move the tasks to"), "c3");
    await user.click(screen.getByRole("button", { name: "Delete column" }));

    expect(onConfirm).toHaveBeenCalledWith({ kind: "moveTo", columnId: "c3" });
  });

  it("deletes the tasks only when that is explicitly chosen", async () => {
    const { onConfirm, user } = setup({ taskCount: 3 });

    await user.click(screen.getByRole("radio", { name: /Delete the tasks too/ }));
    await user.click(screen.getByRole("button", { name: "Delete column" }));

    expect(onConfirm).toHaveBeenCalledWith({ kind: "deleteTasks" });
  });

  it("offers the column being deleted as a target to nothing", () => {
    setup({ taskCount: 3 });

    const select = screen.getByLabelText("Column to move the tasks to");
    expect(select).not.toHaveTextContent("In Progress");
  });

  it("will not delete while the task count is still unknown", () => {
    setup({ taskCount: undefined });
    expect(screen.getByRole("button", { name: "Delete column" })).toBeDisabled();
  });

  it("will not delete when the task count could not be read", () => {
    // Failing closed matters here: deleting a column whose contents we could not
    // read is precisely where a wrong guess costs the user work.
    setup({ taskCount: undefined, countFailed: true });

    expect(screen.getByRole("button", { name: "Delete column" })).toBeDisabled();
    expect(screen.getByText(/could not be counted/)).toBeInTheDocument();
  });

  it("focuses Cancel rather than the destructive action", async () => {
    setup({ taskCount: 3 });
    expect(await screen.findByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("names the column being deleted", () => {
    setup();
    expect(screen.getByRole("alertdialog", { name: /In Progress/ })).toBeInTheDocument();
  });
});
