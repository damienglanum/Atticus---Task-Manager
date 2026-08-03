import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ipc } from "@/lib/ipc";
import { renderWithProviders } from "@/test/render";
import { McpPanel } from "./McpPanel";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    mcpSettingsGet: vi.fn(),
    mcpSettingsSet: vi.fn(),
    mcpLaunchConfig: vi.fn(),
  },
}));

describe("McpPanel", () => {
  beforeEach(() => {
    vi.mocked(ipc.mcpLaunchConfig).mockResolvedValue({
      command: "/Applications/Atticus.app/Contents/MacOS/Atticus",
      args: ["--mcp"],
    });
    vi.mocked(ipc.mcpSettingsSet).mockImplementation((settings) => Promise.resolve(settings));
  });

  it("clears the independent file permission when write access is removed", async () => {
    const user = userEvent.setup();
    vi.mocked(ipc.mcpSettingsGet).mockResolvedValue({
      access: "read_write",
      allowFileAttachments: true,
    });

    renderWithProviders(<McpPanel />);

    const filePermission = await screen.findByRole("checkbox", {
      name: "Allow AI to add file references",
    });
    await waitFor(() => {
      expect(filePermission).toBeEnabled();
      expect(filePermission).toBeChecked();
    });

    await user.click(screen.getByRole("radio", { name: /Read only/ }));

    await waitFor(() => {
      expect(ipc.mcpSettingsSet).toHaveBeenCalledWith({
        access: "read_only",
        allowFileAttachments: false,
      });
    });
    expect(screen.getByRole("radio", { name: /Read only/ })).toBeChecked();
    expect(filePermission).toBeDisabled();
    expect(filePermission).not.toBeChecked();
  });

  it("keeps file references independently disabled when write access is enabled", async () => {
    const user = userEvent.setup();
    vi.mocked(ipc.mcpSettingsGet).mockResolvedValue({
      access: "read_only",
      allowFileAttachments: false,
    });

    renderWithProviders(<McpPanel />);

    const write = await screen.findByRole("radio", { name: /Read & write/ });
    await user.click(write);

    await waitFor(() => {
      expect(ipc.mcpSettingsSet).toHaveBeenCalledWith({
        access: "read_write",
        allowFileAttachments: false,
      });
    });

    const filePermission = screen.getByRole("checkbox", {
      name: "Allow AI to add file references",
    });
    expect(filePermission).toBeEnabled();
    expect(filePermission).not.toBeChecked();

    await user.click(filePermission);
    await waitFor(() => {
      expect(ipc.mcpSettingsSet).toHaveBeenLastCalledWith({
        access: "read_write",
        allowFileAttachments: true,
      });
    });
  });

  it("makes note-body access and the managed-project write boundary explicit", async () => {
    vi.mocked(ipc.mcpSettingsGet).mockResolvedValue({
      access: "read_only",
      allowFileAttachments: false,
    });

    renderWithProviders(<McpPanel />);

    expect(
      await screen.findByText(/full project-note bodies, but cannot change anything/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/create and change tasks and project notes only in projects it created/i),
    ).toBeInTheDocument();
  });

  it("renders independent errors for settings and launch configuration", async () => {
    vi.mocked(ipc.mcpSettingsGet).mockRejectedValue(new Error("settings unavailable"));
    vi.mocked(ipc.mcpLaunchConfig).mockRejectedValue(new Error("launch unavailable"));

    renderWithProviders(<McpPanel />);

    expect(await screen.findByText("AI access could not be read.")).toBeInTheDocument();
    expect(
      await screen.findByText("The local launch configuration could not be read."),
    ).toBeInTheDocument();
  });
});
