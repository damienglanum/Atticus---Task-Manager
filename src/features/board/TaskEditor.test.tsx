import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TaskDetail } from "@/lib/bindings/TaskDetail";
import { ipc } from "@/lib/ipc";
import { renderWithProviders } from "@/test/render";

import { todayIso } from "./dates";
import { TaskEditor } from "./TaskEditor";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    taskDetail: vi.fn(),
    taskUpdate: vi.fn(),
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

function detail(overrides: Partial<TaskDetail> = {}): TaskDetail {
  return {
    task: {
      id: "t1",
      projectId: "p1",
      boardId: "b1",
      columnId: "todo",
      number: 14,
      title: "Write the release notes",
      description: "",
      priority: 0,
      dueDate: null,
      estimateMinutes: null,
      position: 0,
      archivedAt: null,
      createdAt: 0,
      updatedAt: 0,
    },
    subtasks: [],
    labelIds: [],
    fileRefs: [],
    availableLabels: [],
    ...overrides,
  };
}

const taskDetail = vi.mocked(ipc.taskDetail);
const taskUpdate = vi.mocked(ipc.taskUpdate);
const pickFile = vi.mocked(ipc.pickFile);
const fileRefAdd = vi.mocked(ipc.fileRefAdd);
const fileRefReveal = vi.mocked(ipc.fileRefReveal);

beforeEach(() => {
  vi.clearAllMocks();
  taskDetail.mockResolvedValue(detail());
  taskUpdate.mockImplementation((_id, _patch) => Promise.resolve(detail().task));
});

function render() {
  const view = renderWithProviders(
    <TaskEditor taskId="t1" boardId="b1" projectPrefix="TKB" onOpenChange={vi.fn()} />,
  );
  return { user: userEvent.setup(), ...view };
}

describe("TaskEditor", () => {
  it("shows the task's stable short ID and can copy it", async () => {
    // `userEvent.setup()` installs its own clipboard stub, so the assertion
    // reads what actually landed there rather than spying on a replaced method.
    const { user } = render();
    // The editor names itself after the task, not after the reference — see the
    // note on `title` in TaskEditor. The reference is above it, and copyable.
    await screen.findByRole("dialog", { name: "Write the release notes" });

    await user.click(screen.getByRole("button", { name: "Copy TKB-14" }));

    await waitFor(async () => {
      expect(await navigator.clipboard.readText()).toBe("TKB-14");
    });
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("saves the title after typing stops, without a save button", async () => {
    const { user } = render();
    await screen.findByLabelText("Title");

    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Title"), "!");

    await waitFor(() => {
      expect(taskUpdate).toHaveBeenCalledWith("t1", { title: "Write the release notes!" });
    });
  });

  it("saves a description that is still being typed when the editor closes", async () => {
    // The case that would otherwise lose real work: close mid-sentence, before
    // the debounce fires. Regression — the first implementation flushed in an
    // unmount cleanup, where the mutation never reached the backend.
    const { user } = render();
    await screen.findByLabelText("Edit description");

    await user.type(screen.getByLabelText("Edit description"), "half a thought");
    await user.click(screen.getByRole("button", { name: "Back to the board" }));

    await waitFor(() => {
      expect(taskUpdate).toHaveBeenCalledWith("t1", { description: "half a thought" });
    });
  });

  it("renders the description as markdown, not as raw text", async () => {
    taskDetail.mockResolvedValue(
      detail({ task: { ...detail().task, description: "# A heading" } }),
    );

    render();

    // A task that already has a description opens showing it rendered, not as
    // a textarea full of markup.
    expect(await screen.findByRole("heading", { name: "A heading" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit the description" })).toBeInTheDocument();
  });

  it("offers every priority level with a name", async () => {
    render();
    await screen.findByRole("group", { name: "Priority" });

    for (const level of ["None", "Low", "Medium", "High", "Urgent"]) {
      expect(screen.getByRole("radio", { name: level })).toBeInTheDocument();
    }
  });

  it("saves a chosen priority immediately", async () => {
    const { user } = render();
    await screen.findByRole("radio", { name: "High" });

    await user.click(screen.getByRole("radio", { name: "High" }));
    expect(taskUpdate).toHaveBeenCalledWith("t1", { priority: 3 });
  });

  it("clears a due date rather than sending an empty string", async () => {
    taskDetail.mockResolvedValue(detail({ task: { ...detail().task, dueDate: "2026-08-14" } }));

    const { user } = render();
    const field = await screen.findByLabelText("Due date");

    await user.clear(field);
    await waitFor(() => {
      expect(taskUpdate).toHaveBeenCalledWith("t1", { clearDueDate: true });
    });
  });

  it("says a due date is unset, because the empty control does not", async () => {
    // WebKit draws today's date greyed inside an empty `input[type=date]`
    // instead of a placeholder, so "no due date" and "due today" look the same.
    // M6's visual review recorded it; the words under the field are the fix.
    render();

    expect(await screen.findByText("No due date")).toBeInTheDocument();
  });

  it("replaces those words with the due state once a date is set", async () => {
    taskDetail.mockResolvedValue(detail({ task: { ...detail().task, dueDate: todayIso() } }));

    render();

    expect(await screen.findByText("Due today")).toBeInTheDocument();
    expect(screen.queryByText("No due date")).not.toBeInTheDocument();
  });

  it("refuses an estimate it cannot parse, and says what would work", async () => {
    const { user } = render();
    const field = await screen.findByLabelText("Estimate");

    await user.type(field, "soon");
    await user.tab();

    expect(await screen.findByRole("alert")).toHaveTextContent("Try 90, 1h 30m, or 2h.");
    expect(taskUpdate).not.toHaveBeenCalled();
  });

  it("accepts an estimate written as hours and minutes", async () => {
    const { user } = render();
    const field = await screen.findByLabelText("Estimate");

    await user.type(field, "1h 30m");
    await user.tab();

    expect(taskUpdate).toHaveBeenCalledWith("t1", { estimateMinutes: 90 });
  });

  it("shows a missing file's path and offers to locate it", async () => {
    taskDetail.mockResolvedValue(
      detail({
        fileRefs: [
          {
            id: "f1",
            taskId: "t1",
            path: "/Users/someone/gone.pdf",
            displayName: "gone.pdf",
            lastVerifiedAt: 0,
            found: false,
            position: 0,
            createdAt: 0,
          },
        ],
      }),
    );

    render();

    expect(await screen.findByText("Missing — this file is not there now")).toBeInTheDocument();
    expect(screen.getByText("/Users/someone/gone.pdf")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Locate “gone.pdf”" })).toBeInTheDocument();
    // No reveal action for a file that is not there.
    expect(
      screen.queryByRole("button", { name: "Show “gone.pdf” in Finder" }),
    ).not.toBeInTheDocument();
  });

  it("links a file chosen from the system dialog", async () => {
    pickFile.mockResolvedValue("/Users/someone/spec.pdf");
    fileRefAdd.mockResolvedValue({
      id: "f1",
      taskId: "t1",
      path: "/Users/someone/spec.pdf",
      displayName: "spec.pdf",
      lastVerifiedAt: 0,
      found: true,
      position: 0,
      createdAt: 0,
    });

    const { user } = render();
    await user.click(await screen.findByRole("button", { name: "Link a file" }));

    await waitFor(() => {
      expect(fileRefAdd).toHaveBeenCalledWith("t1", "/Users/someone/spec.pdf");
    });
  });

  it("reveals a file by reference id, never by passing a path", async () => {
    fileRefReveal.mockResolvedValue(null);
    taskDetail.mockResolvedValue(
      detail({
        fileRefs: [
          {
            id: "f1",
            taskId: "t1",
            path: "/Users/someone/spec.pdf",
            displayName: "spec.pdf",
            lastVerifiedAt: 0,
            found: true,
            position: 0,
            createdAt: 0,
          },
        ],
      }),
    );

    const { user } = render();
    await user.click(await screen.findByRole("button", { name: "Show “spec.pdf” in Finder" }));

    expect(fileRefReveal).toHaveBeenCalledWith("f1");
  });

  it("does not add a file when the dialog is cancelled", async () => {
    pickFile.mockResolvedValue(null);

    const { user } = render();
    await user.click(await screen.findByRole("button", { name: "Link a file" }));

    await waitFor(() => {
      expect(pickFile).toHaveBeenCalled();
    });
    expect(fileRefAdd).not.toHaveBeenCalled();
  });
});
