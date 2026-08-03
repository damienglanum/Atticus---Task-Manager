import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ipc } from "@/lib/ipc";
import { renderWithProviders } from "@/test/render";
import { SettingsDialog } from "./SettingsDialog";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    appInfo: vi.fn(),
    databaseInfo: vi.fn(),
    backupsList: vi.fn(),
    backupCreate: vi.fn(),
    backupRestore: vi.fn(),
    exportData: vi.fn(),
    importPreview: vi.fn(),
    importApply: vi.fn(),
    pickImportFile: vi.fn(),
    pickExportDestination: vi.fn(),
  },
}));

describe("SettingsDialog", () => {
  beforeEach(() => {
    vi.mocked(ipc.appInfo).mockResolvedValue({
      name: "Atticus",
      version: "0.1.4",
      dataDir: "/data",
      platform: "macOS",
    });
    vi.mocked(ipc.databaseInfo).mockResolvedValue({
      path: "/data/atticus.sqlite3",
      sizeBytes: 4096,
      schemaVersion: 8,
      latestSchemaVersion: 8,
      backupDirectory: "/data/backups",
      backupCount: 2,
    });
    vi.mocked(ipc.backupsList).mockResolvedValue([]);
  });

  it("separates general, data, and installation settings", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <SettingsDialog
        open
        onOpenChange={vi.fn()}
        theme="system"
        onThemeChange={vi.fn()}
        themePending={false}
        projects={[]}
        onDataReplaced={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "General" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Appearance")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Data" }));
    expect(screen.getByText("Export and import")).toBeInTheDocument();
    expect(screen.queryByText("Appearance")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "About" }));
    expect(await screen.findByText("Installation details")).toBeInTheDocument();
    expect(screen.getByText("0.1.4")).toBeInTheDocument();
  });
});
