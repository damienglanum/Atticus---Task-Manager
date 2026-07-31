import { screen, waitFor, within } from "@testing-library/react";
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
    taskMove: vi.fn(),
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
const taskMove = vi.mocked(ipc.taskMove);

beforeEach(() => {
  vi.clearAllMocks();
  taskDetail.mockResolvedValue(detail());
  taskUpdate.mockImplementation((_id, _patch) => Promise.resolve(detail().task));
});

const COLUMNS = [
  {
    id: "c1",
    boardId: "b1",
    name: "Todo",
    wipLimit: null,
    position: 0,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: "c2",
    boardId: "b1",
    name: "Done",
    wipLimit: null,
    position: 1,
    createdAt: 0,
    updatedAt: 0,
  },
];

function render(onOpenChange = vi.fn()) {
  const view = renderWithProviders(
    <TaskEditor
      taskId="t1"
      projectPrefix="TKB"
      boardName="Roadmap"
      columns={COLUMNS}
      onSaved={vi.fn()}
      onOpenChange={onOpenChange}
    />,
  );
  return { user: userEvent.setup(), onOpenChange, ...view };
}

describe("TaskEditor", () => {
  it("shows the task's stable short ID and can copy it", async () => {
    // `userEvent.setup()` installs its own clipboard stub, so the assertion
    // reads what actually landed there rather than spying on a replaced method.
    const { user } = render();
    await screen.findByRole("dialog", { name: "Edit task" });

    await user.click(screen.getByRole("button", { name: "Copy TKB-14" }));

    await waitFor(async () => {
      expect(await navigator.clipboard.readText()).toBe("TKB-14");
    });
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("writes nothing until Save changes is pressed", async () => {
    // The contract v1.1 replaced autosave with. Typing is a draft, and a draft
    // that reached the database would make Cancel a lie.
    const { user } = render();
    await screen.findByLabelText("Task title");

    await user.type(screen.getByLabelText("Task title"), "!");
    await user.type(screen.getByLabelText("Edit description"), " and more");

    expect(taskUpdate).not.toHaveBeenCalled();
  });

  it("writes the whole draft when Save changes is pressed", async () => {
    const { user } = render();
    await screen.findByLabelText("Task title");

    await user.type(screen.getByLabelText("Task title"), "!");
    await user.click(screen.getByRole("button", { name: /Save changes/ }));

    await waitFor(() => {
      expect(taskUpdate).toHaveBeenCalledWith("t1", { title: "Write the release notes!" });
    });
  });

  it("keeps Save changes unavailable until something actually changes", async () => {
    // Otherwise every open-and-close stamps `updated_at` on a task nobody edited.
    render();
    await screen.findByLabelText("Task title");

    expect(screen.getByRole("button", { name: /Save changes/ })).toBeDisabled();
  });

  it("asks before throwing away an edit, and writes nothing when it does", async () => {
    const { user, onOpenChange } = render();
    await screen.findByLabelText("Edit description");

    await user.type(screen.getByLabelText("Edit description"), "half a thought");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    // The guard that replaces autosave: closing dirty is a question, not a
    // silent discard.
    await screen.findByRole("alertdialog", { name: "Discard your changes?" });
    await user.click(screen.getByRole("button", { name: "Discard" }));

    expect(taskUpdate).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders the description as markdown when previewing", async () => {
    // The editor opens ready to type, as the design asks — the preview is one
    // button away rather than the state you land in.
    taskDetail.mockResolvedValue(
      detail({ task: { ...detail().task, description: "# A heading" } }),
    );

    const { user } = render();
    await user.click(await screen.findByRole("button", { name: "Preview the description" }));

    expect(await screen.findByRole("heading", { name: "A heading" })).toBeInTheDocument();
  });

  it("offers every priority level with a name", async () => {
    render();
    const field = await screen.findByLabelText("Priority");

    for (const level of ["None", "Low", "Medium", "High", "Urgent"]) {
      expect(within(field).getByRole("option", { name: level })).toBeInTheDocument();
    }
  });

  it("moves a task between columns by changing its status", async () => {
    // Status is the column: there is no second field that could disagree with
    // where the card actually is on the board.
    const { user } = render();
    const field = await screen.findByLabelText("Status");

    await user.selectOptions(field, "c2");
    await user.click(screen.getByRole("button", { name: /Save changes/ }));

    await waitFor(() => {
      expect(taskMove).toHaveBeenCalledWith("t1", "c2", Number.MAX_SAFE_INTEGER);
    });
  });

  it("clears a due date rather than sending an empty string", async () => {
    taskDetail.mockResolvedValue(detail({ task: { ...detail().task, dueDate: "2026-08-14" } }));

    const { user } = render();
    const field = await screen.findByLabelText("Due date");

    await user.clear(field);
    await user.click(screen.getByRole("button", { name: /Save changes/ }));

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
    await user.click(screen.getByRole("button", { name: /Save changes/ }));

    await waitFor(() => {
      expect(taskUpdate).toHaveBeenCalledWith("t1", { estimateMinutes: 90 });
    });
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

    const { user } = render();

    expect(await screen.findByText("This file is not where it was")).toBeInTheDocument();
    // The remembered path is the only clue to where the file went.
    expect(screen.getByText("/Users/someone/gone.pdf")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Actions for gone.pdf" }));
    expect(await screen.findByRole("menuitem", { name: /Locate this file/ })).toBeInTheDocument();
    // No reveal action for a file that is not there.
    expect(screen.queryByRole("menuitem", { name: /Reveal in Finder/ })).not.toBeInTheDocument();
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
    await user.click(await screen.findByRole("button", { name: /Link files/ }));

    // Staged, not written: the link is part of the draft until Save, like
    // everything else the editor can change.
    expect(await screen.findByText("spec.pdf")).toBeInTheDocument();
    expect(fileRefAdd).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Save changes/ }));
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
    await user.click(await screen.findByRole("button", { name: "Actions for spec.pdf" }));
    await user.click(await screen.findByRole("menuitem", { name: /Reveal in Finder/ }));

    expect(fileRefReveal).toHaveBeenCalledWith("f1");
  });

  it("does not add a file when the dialog is cancelled", async () => {
    pickFile.mockResolvedValue(null);

    const { user } = render();
    await user.click(await screen.findByRole("button", { name: /Link files/ }));

    await waitFor(() => {
      expect(pickFile).toHaveBeenCalled();
    });
    expect(fileRefAdd).not.toHaveBeenCalled();
  });
});
