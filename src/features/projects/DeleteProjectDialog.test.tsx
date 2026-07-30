import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Project } from "@/lib/bindings/Project";
import { ipc } from "@/lib/ipc";
import { renderWithProviders } from "@/test/render";
import { DeleteProjectDialog } from "./DeleteProjectDialog";

vi.mock("@/lib/ipc", () => ({
  ipc: { projectDeletePreview: vi.fn() },
}));

const project: Project = {
  id: "p1",
  name: "Precious",
  description: "",
  color: "indigo",
  keyPrefix: "PRE",
  nextTaskNumber: 1,
  directoryPath: null,
  directoryMissing: false,
  position: 0,
  archivedAt: null,
  createdAt: 0,
  updatedAt: 0,
};

const preview = vi.mocked(ipc.projectDeletePreview);

beforeEach(() => {
  preview.mockResolvedValue({ boards: 2, columns: 10, tasks: 37, subtasks: 12, labels: 4 });
});

function setup() {
  const onConfirm = vi.fn();
  renderWithProviders(
    <DeleteProjectDialog
      open
      onOpenChange={vi.fn()}
      project={project}
      onConfirm={onConfirm}
      pending={false}
    />,
  );
  return { onConfirm };
}

describe("DeleteProjectDialog", () => {
  it("states the real counts rather than a vague warning", async () => {
    setup();

    expect(await screen.findByText("37")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("This cannot be undone.")).toBeInTheDocument();
  });

  it("keeps deletion disabled until the name is typed exactly", async () => {
    const { onConfirm } = setup();
    await screen.findByText("37");

    const confirm = screen.getByRole("button", { name: "Delete permanently" });
    expect(confirm).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Type Precious to confirm"), "precious");
    expect(confirm).toBeDisabled();

    await userEvent.clear(screen.getByLabelText("Type Precious to confirm"));
    await userEvent.type(screen.getByLabelText("Type Precious to confirm"), "Precious");
    expect(confirm).toBeEnabled();

    await userEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith("Precious");
  });

  it("blocks deletion when the counts could not be read", async () => {
    preview.mockRejectedValue(new Error("nope"));
    setup();

    expect(await screen.findByRole("alert")).toHaveTextContent(/deletion is blocked/i);
    await userEvent.type(screen.getByLabelText("Type Precious to confirm"), "Precious");
    expect(screen.getByRole("button", { name: "Delete permanently" })).toBeDisabled();
  });

  it("offers Cancel as well, and it is not the destructive one", async () => {
    setup();
    await screen.findByText("37");

    // Both routes out exist; the safe one is present and enabled from the start.
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });

  it("does not count anything until it is actually opened", () => {
    renderWithProviders(
      <DeleteProjectDialog
        open={false}
        onOpenChange={vi.fn()}
        project={project}
        onConfirm={vi.fn()}
        pending={false}
      />,
    );

    expect(preview).not.toHaveBeenCalled();
  });

  it("waits for the counts before allowing deletion", async () => {
    let release: (value: {
      boards: number;
      columns: number;
      tasks: number;
      subtasks: number;
      labels: number;
    }) => void = () => undefined;
    preview.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    setup();

    await userEvent.type(screen.getByLabelText("Type Precious to confirm"), "Precious");
    expect(screen.getByRole("button", { name: "Delete permanently" })).toBeDisabled();

    release({ boards: 1, columns: 5, tasks: 0, subtasks: 0, labels: 0 });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Delete permanently" })).toBeEnabled();
    });
  });
});
