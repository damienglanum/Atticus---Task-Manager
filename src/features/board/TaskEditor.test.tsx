import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TaskDetail } from "@/lib/bindings/TaskDetail";
import { ipc } from "@/lib/ipc";
import { renderWithProviders } from "@/test/render";

import { todayIso } from "./dates";
import { TaskEditor } from "./TaskEditor";
import { IDLE_PREVIEW_DELAY_MS } from "@/components/ui/useIdlePreview";

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
    labelUpdate: vi.fn(),
    fileRefAdd: vi.fn(),
    fileRefRelocate: vi.fn(),
    fileRefRemove: vi.fn(),
    fileRefReveal: vi.fn(),
    linkRefAdd: vi.fn(),
    linkRefRemove: vi.fn(),
    openExternal: vi.fn(),
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
    linkRefs: [],
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
const labelCreate = vi.mocked(ipc.labelCreate);
const labelUpdate = vi.mocked(ipc.labelUpdate);
const linkRefAdd = vi.mocked(ipc.linkRefAdd);
const openExternal = vi.mocked(ipc.openExternal);

beforeEach(() => {
  vi.clearAllMocks();
  taskDetail.mockResolvedValue(detail());
  taskUpdate.mockImplementation((_id, _patch) => Promise.resolve(detail().task));
});

afterEach(() => {
  vi.useRealTimers();
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
  it("uses the full-page work surface without explaining the writing format", async () => {
    render();

    await screen.findByLabelText("Edit description");
    expect(document.querySelector("[data-task-editor-main]")).not.toBeNull();
    expect(document.querySelector("[data-task-editor-rail]")).not.toBeNull();
    expect(screen.queryByText(/Markdown \/ auto preview/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Edit description")).toHaveAttribute(
      "placeholder",
      "Add context, decisions, or acceptance criteria…",
    );
    expect(screen.queryByText(/Atticus \/ working copy/i)).not.toBeInTheDocument();
    expect(screen.getByText("Atticus")).toBeInTheDocument();
    expect(screen.getByText("Careful work starts with a clear view.")).toBeInTheDocument();
  });

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

  it("returns to rendered markdown after typing stops", async () => {
    render();
    const description = await screen.findByLabelText("Edit description");

    vi.useFakeTimers();
    fireEvent.change(description, { target: { value: "# Automatically rendered" } });

    act(() => {
      vi.advanceTimersByTime(IDLE_PREVIEW_DELAY_MS - 1);
    });
    expect(
      screen.queryByRole("heading", { name: "Automatically rendered" }),
    ).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    vi.useRealTimers();

    expect(screen.getByRole("heading", { name: "Automatically rendered" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Edit description")).not.toBeInTheDocument();
  });

  it("offers every priority level with a name", async () => {
    const { user } = render();
    const field = await screen.findByLabelText("Priority");
    await user.click(field);

    for (const level of ["None", "Low", "Medium", "High", "Urgent"]) {
      expect(screen.getByRole("menuitemradio", { name: level })).toBeInTheDocument();
    }
  });

  it("moves a task between columns by changing its status", async () => {
    // Status is the column: there is no second field that could disagree with
    // where the card actually is on the board.
    const { user } = render();
    const field = await screen.findByLabelText("Status");

    await user.click(field);
    await user.click(screen.getByRole("menuitemradio", { name: "Done" }));
    await user.click(screen.getByRole("button", { name: /Save changes/ }));

    await waitFor(() => {
      expect(taskMove).toHaveBeenCalledWith("t1", "c2", Number.MAX_SAFE_INTEGER);
    });
  });

  it("clears a due date rather than sending an empty string", async () => {
    taskDetail.mockResolvedValue(detail({ task: { ...detail().task, dueDate: "2026-08-14" } }));

    const { user } = render();
    const field = await screen.findByLabelText("Due date");

    await user.click(field);
    await user.click(screen.getByRole("button", { name: "Clear due date" }));
    await user.click(screen.getByRole("button", { name: /Save changes/ }));

    await waitFor(() => {
      expect(taskUpdate).toHaveBeenCalledWith("t1", { clearDueDate: true });
    });
  });

  it("chooses a due date from the Atticus calendar", async () => {
    taskDetail.mockResolvedValue(detail({ task: { ...detail().task, dueDate: "2026-08-01" } }));
    const { user } = render();
    await user.click(await screen.findByLabelText("Due date"));

    const day = document.querySelector<HTMLButtonElement>('[data-date="2026-08-14"]');
    if (day === null) throw new Error("The expected calendar day was not rendered.");
    await user.click(day);
    await user.click(screen.getByRole("button", { name: /Save changes/ }));

    await waitFor(() => {
      expect(taskUpdate).toHaveBeenCalledWith("t1", { dueDate: "2026-08-14" });
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

  it("creates a tag with the colour selected by the user", async () => {
    labelCreate.mockResolvedValue({
      id: "l1",
      projectId: "p1",
      name: "Blocked",
      color: "red",
      createdAt: 0,
      updatedAt: 0,
    });

    const { user } = render();
    await user.click(await screen.findByRole("button", { name: "Add tag" }));
    await user.type(screen.getByLabelText("Tag name"), "Blocked");
    await user.click(screen.getByRole("radio", { name: "red" }));
    await user.click(screen.getByRole("button", { name: "Add “Blocked”" }));

    await waitFor(() => {
      expect(labelCreate).toHaveBeenCalledWith("p1", { name: "Blocked", color: "red" });
    });
  });

  it("uses a selected tag's colour for the whole pill", async () => {
    taskDetail.mockResolvedValue(
      detail({
        labelIds: ["l1"],
        availableLabels: [
          {
            id: "l1",
            projectId: "p1",
            name: "Blocked",
            color: "red",
            createdAt: 0,
            updatedAt: 0,
          },
        ],
      }),
    );

    render();

    expect((await screen.findByText("Blocked")).parentElement?.getAttribute("style")).toContain(
      "background-color: var(--label-red)",
    );
  });

  it("recolours an existing tag instead of silently reusing its old grey colour", async () => {
    const oldLabel = {
      id: "l1",
      projectId: "p1",
      name: "Blocked",
      color: "slate",
      createdAt: 0,
      updatedAt: 0,
    };
    taskDetail.mockResolvedValue(detail({ availableLabels: [oldLabel] }));
    labelUpdate.mockResolvedValue({ ...oldLabel, color: "red" });

    const { user } = render();
    await user.click(await screen.findByRole("button", { name: "Add tag" }));
    await user.type(screen.getByLabelText("Tag name"), "Blocked");
    await user.click(screen.getByRole("radio", { name: "red" }));
    await user.click(screen.getByRole("button", { name: "Add “Blocked”" }));

    await waitFor(() => {
      expect(labelUpdate).toHaveBeenCalledWith("l1", { name: "Blocked", color: "red" });
    });
    expect(labelCreate).not.toHaveBeenCalled();
  });

  it("does not show unused labels as tag history", async () => {
    taskDetail.mockResolvedValue(
      detail({
        availableLabels: [
          {
            id: "l1",
            projectId: "p1",
            name: "Old tag",
            color: "slate",
            createdAt: 0,
            updatedAt: 0,
          },
        ],
      }),
    );

    const { user } = render();
    await user.click(await screen.findByRole("button", { name: "Add tag" }));

    expect(screen.queryByText("Old tag")).not.toBeInTheDocument();
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

  it("stages a web link and persists it only when Save changes is pressed", async () => {
    linkRefAdd.mockResolvedValue({
      id: "w1",
      taskId: "t1",
      url: "https://example.com/docs",
      position: 0,
      createdAt: 0,
    });

    const { user } = render();
    await user.click(await screen.findByRole("button", { name: "Add link" }));
    await user.type(screen.getByLabelText("Link URL"), "example.com/docs");
    await user.click(screen.getByRole("button", { name: "Add link" }));

    expect(await screen.findByText("example.com")).toBeInTheDocument();
    expect(linkRefAdd).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Save changes/ }));
    await waitFor(() => {
      expect(linkRefAdd).toHaveBeenCalledWith("t1", "https://example.com/docs");
    });
  });

  it("rejects unsafe link schemes", async () => {
    const { user } = render();
    await user.click(await screen.findByRole("button", { name: "Add link" }));
    await user.type(screen.getByLabelText("Link URL"), "file:///tmp/private");
    await user.click(screen.getByRole("button", { name: "Add link" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a valid web address");
    expect(linkRefAdd).not.toHaveBeenCalled();
  });

  it("opens a stored link through the safe external-link boundary", async () => {
    openExternal.mockResolvedValue(null);
    taskDetail.mockResolvedValue(
      detail({
        linkRefs: [
          {
            id: "w1",
            taskId: "t1",
            url: "https://example.com/spec",
            position: 0,
            createdAt: 0,
          },
        ],
      }),
    );

    const { user } = render();
    await user.click(await screen.findByRole("button", { name: "Actions for example.com" }));
    await user.click(screen.getByRole("menuitem", { name: "Open link" }));

    expect(openExternal).toHaveBeenCalledWith("https://example.com/spec");
  });
});
