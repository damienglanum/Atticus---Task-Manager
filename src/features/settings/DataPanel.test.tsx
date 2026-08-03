import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ImportPlan } from "@/lib/bindings/ImportPlan";
import type { Project } from "@/lib/bindings/Project";
import { ipc } from "@/lib/ipc";
import { renderWithProviders } from "@/test/render";

import { DataPanel } from "./DataPanel";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    backupsList: vi.fn(),
    backupRestore: vi.fn(),
    exportData: vi.fn(),
    importPreview: vi.fn(),
    importApply: vi.fn(),
    pickImportFile: vi.fn(),
    pickExportDestination: vi.fn(),
  },
}));

const backupsList = vi.mocked(ipc.backupsList);
const importPreview = vi.mocked(ipc.importPreview);
const importApply = vi.mocked(ipc.importApply);
const pickImportFile = vi.mocked(ipc.pickImportFile);
const pickExportDestination = vi.mocked(ipc.pickExportDestination);
const exportData = vi.mocked(ipc.exportData);

function plan(partial: Partial<ImportPlan> = {}): ImportPlan {
  return {
    projects: 1,
    boards: 1,
    columns: 5,
    tasks: 12,
    subtasks: 0,
    labels: 0,
    fileRefs: 0,
    linkRefs: 0,
    savedFilters: 0,
    notes: 0,
    ...partial,
  };
}

const PROJECT: Project = {
  id: "p1",
  name: "Atticus",
  description: "",
  color: "indigo",
  keyPrefix: "ATT",
  nextTaskNumber: 1,
  directoryPath: null,
  directoryMissing: false,
  position: 0,
  archivedAt: null,
  createdAt: 0,
  updatedAt: 0,
};

function render() {
  const onDataReplaced = vi.fn();
  const user = userEvent.setup();
  renderWithProviders(<DataPanel projects={[PROJECT]} onDataReplaced={onDataReplaced} />);
  return { user, onDataReplaced };
}

/** Walks from "Import…" to the dry-run summary being on screen. */
async function previewAFile(user: ReturnType<typeof userEvent.setup>) {
  pickImportFile.mockResolvedValue("/tmp/export.json");
  await user.click(screen.getByRole("button", { name: "Import…" }));
  await screen.findByText(/1 project, 1 board, 5 columns, 12 tasks/);
}

describe("DataPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    backupsList.mockResolvedValue([]);
    importPreview.mockResolvedValue(plan());
  });

  it("states what an import would create before writing anything", async () => {
    const { user } = render();

    await previewAFile(user);

    expect(importApply).not.toHaveBeenCalled();
  });

  it("imports in merge mode without further confirmation", async () => {
    // Adding cannot destroy anything, so it does not get a second gate.
    const { user } = render();
    importApply.mockResolvedValue({ created: plan(), mode: "merge" });

    await previewAFile(user);
    await user.click(screen.getByRole("button", { name: "Add to what's here" }));

    await waitFor(() => {
      expect(importApply).toHaveBeenCalledExactlyOnceWith("/tmp/export.json", "merge");
    });
  });

  it("will not replace until the word is typed", async () => {
    const { user } = render();

    await previewAFile(user);
    await user.click(screen.getByRole("button", { name: "Replace everything…" }));

    const confirm = await screen.findByRole("button", { name: "Replace everything" });
    expect(confirm).toBeDisabled();

    await user.type(screen.getByLabelText(/Type replace to confirm/), "replace");
    expect(confirm).toBeEnabled();

    await user.click(confirm);
    await waitFor(() => {
      expect(importApply).toHaveBeenCalledExactlyOnceWith("/tmp/export.json", "replace");
    });
  });

  it("refuses a near-miss of the typed word", async () => {
    const { user } = render();

    await previewAFile(user);
    await user.click(screen.getByRole("button", { name: "Replace everything…" }));
    await user.type(screen.getByLabelText(/Type replace to confirm/), "replac");

    expect(screen.getByRole("button", { name: "Replace everything" })).toBeDisabled();
  });

  it("lists every problem with its path when the file is invalid", async () => {
    // The list is what makes a hand-edited export repairable in one pass, so it
    // has to reach the screen rather than being summarised into a toast.
    pickImportFile.mockResolvedValue("/tmp/broken.json");
    importPreview.mockRejectedValue({
      kind: "import_invalid",
      issues: [
        { path: "data.tasks[0].columnId", message: "No column with id nope is in this file." },
        { path: "data.tasks[0].priority", message: "Priority must be 0 to 4; this is 9." },
      ],
    });
    const { user } = render();

    await user.click(screen.getByRole("button", { name: "Import…" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Nothing has been changed");
    expect(alert).toHaveTextContent("data.tasks[0].columnId");
    expect(alert).toHaveTextContent("data.tasks[0].priority");
    expect(importApply).not.toHaveBeenCalled();
  });

  it("treats a cancelled file dialog as nothing having happened", async () => {
    pickImportFile.mockResolvedValue(null);
    const { user } = render();

    await user.click(screen.getByRole("button", { name: "Import…" }));

    await waitFor(() => {
      expect(pickImportFile).toHaveBeenCalled();
    });
    expect(importPreview).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("exports the chosen scope to the chosen file", async () => {
    pickExportDestination.mockResolvedValue("/tmp/out.json");
    exportData.mockResolvedValue("/tmp/out.json");
    const { user } = render();

    await user.selectOptions(screen.getByLabelText("What to export"), "p1");
    await user.click(screen.getByRole("button", { name: "Export…" }));

    await waitFor(() => {
      expect(exportData).toHaveBeenCalledExactlyOnceWith(
        { kind: "project", projectId: "p1" },
        "/tmp/out.json",
      );
    });
  });

  it("does not export when the save dialog is cancelled", async () => {
    pickExportDestination.mockResolvedValue(null);
    const { user } = render();

    await user.click(screen.getByRole("button", { name: "Export…" }));

    await waitFor(() => {
      expect(pickExportDestination).toHaveBeenCalled();
    });
    expect(exportData).not.toHaveBeenCalled();
  });

  it("says a restore is reversible, because it is", async () => {
    backupsList.mockResolvedValue([
      {
        path: "/data/backups/manual-1753822000000.sqlite3",
        fileName: "manual-1753822000000.sqlite3",
        label: "manual",
        manual: true,
        sizeBytes: 4096,
        takenAt: 1_753_822_000_000,
      },
    ]);
    const { user } = render();

    await user.click(await screen.findByRole("button", { name: "Restore…" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("backed up first");
    expect(dialog).toHaveTextContent("put back automatically");
  });
});
