import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Project } from "@/lib/bindings/Project";
import { IpcError } from "@/lib/errors";
import { ProjectDialog } from "./ProjectDialog";

const project: Project = {
  id: "p1",
  name: "Takenkanban",
  description: "A board",
  color: "teal",
  keyPrefix: "TAK",
  nextTaskNumber: 4,
  directoryPath: "/Users/damien/code/takenkanban",
  directoryMissing: false,
  position: 0,
  archivedAt: null,
  createdAt: 0,
  updatedAt: 0,
};

function setup(overrides: Partial<Parameters<typeof ProjectDialog>[0]> = {}) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const onOpenChange = vi.fn();
  render(
    <ProjectDialog
      open
      onOpenChange={onOpenChange}
      onSubmit={onSubmit}
      pending={false}
      {...overrides}
    />,
  );
  return { onSubmit, onOpenChange };
}

describe("ProjectDialog", () => {
  it("opens with focus in the form, not on the close button", async () => {
    setup();

    await waitFor(() => {
      expect(screen.getByLabelText("Name")).toHaveFocus();
    });
  });

  it("refuses to submit an empty name and says why", async () => {
    const { onSubmit } = setup();

    await userEvent.click(screen.getByRole("button", { name: "Create project" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This can't be empty.");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits trimmed, normalised values", async () => {
    const { onSubmit } = setup();

    await userEvent.type(screen.getByLabelText("Name"), "  My Project  ");
    await userEvent.type(screen.getByLabelText("Task ID prefix"), "mp");
    await userEvent.click(screen.getByRole("button", { name: "Create project" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ name: "My Project", keyPrefix: "MP" }),
      );
    });
  });

  it("clears a field's error as soon as it is edited", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Create project" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Name"), "x");

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("puts a backend validation error on the field it names", async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValue(
        new IpcError({ kind: "validation", field: "keyPrefix", message: "Use letters A–Z only." }),
      );
    render(<ProjectDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} pending={false} />);

    await userEvent.type(screen.getByLabelText("Name"), "Valid here");
    await userEvent.click(screen.getByRole("button", { name: "Create project" }));

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("Use letters A–Z only.");
    // The message must be wired to the offending input, not floating loose.
    expect(screen.getByLabelText("Task ID prefix")).toHaveAccessibleDescription(
      expect.stringContaining("Use letters A–Z only."),
    );
  });

  it("reports a non-validation failure without blaming a field", async () => {
    const onSubmit = vi
      .fn()
      .mockRejectedValue(new IpcError({ kind: "database", message: "disk is full" }));
    render(<ProjectDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} pending={false} />);

    await userEvent.type(screen.getByLabelText("Name"), "Valid here");
    await userEvent.click(screen.getByRole("button", { name: "Create project" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("disk is full");
  });

  it("seeds every field when editing", () => {
    setup({ project });

    expect(screen.getByLabelText("Name")).toHaveValue("Takenkanban");
    expect(screen.getByLabelText("Task ID prefix")).toHaveValue("TAK");
    expect(screen.getByLabelText("Project directory")).toHaveValue(
      "/Users/damien/code/takenkanban",
    );
    expect(screen.getByRole("radio", { name: "teal" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
  });

  it("lets the colour be chosen by name, not only by sight", async () => {
    const { onSubmit } = setup({ project });

    await userEvent.click(screen.getByRole("radio", { name: "amber" }));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ color: "amber" }));
    });
  });

  it("disables submission while a save is in flight", () => {
    setup({ pending: true });

    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  });

  it("closes on Escape", async () => {
    const { onOpenChange } = setup();

    await userEvent.keyboard("{Escape}");

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
