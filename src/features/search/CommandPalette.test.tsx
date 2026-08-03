import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SearchHit } from "@/lib/bindings/SearchHit";
import { ipc } from "@/lib/ipc";
import { renderWithProviders } from "@/test/render";

import { CommandPalette } from "./CommandPalette";

vi.mock("@/lib/ipc", () => ({ ipc: { tasksSearch: vi.fn() } }));

const tasksSearch = vi.mocked(ipc.tasksSearch);

function hit(overrides: Partial<SearchHit> = {}): SearchHit {
  return {
    taskId: "t1",
    boardId: "b1",
    projectId: "p1",
    number: 14,
    title: "Write the release notes",
    projectName: "Takenkanban",
    projectKeyPrefix: "TKB",
    boardName: "Board",
    columnName: "Todo",
    archived: false,
    writable: false,
    excerpt: "",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  tasksSearch.mockResolvedValue([]);
});

function setup(commands: React.ComponentProps<typeof CommandPalette>["commands"] = []) {
  const onOpenTask = vi.fn();
  const onOpenChange = vi.fn();
  renderWithProviders(
    <CommandPalette commands={commands} onOpenTask={onOpenTask} onOpenChange={onOpenChange} />,
  );
  return { onOpenTask, onOpenChange, user: userEvent.setup() };
}

const settings = {
  id: "settings",
  label: "Open settings",
  icon: "settings" as const,
  run: vi.fn(),
};

describe("CommandPalette", () => {
  it("focuses its input so typing starts a search immediately", async () => {
    setup();
    await waitFor(() => {
      expect(screen.getByRole("combobox")).toHaveFocus();
    });
  });

  it("does not search until something is typed", () => {
    setup();
    expect(tasksSearch).not.toHaveBeenCalled();
  });

  it("shows results with the project, board and column they live in", async () => {
    tasksSearch.mockResolvedValue([hit()]);
    const { user } = setup();

    await user.type(screen.getByRole("combobox"), "release");

    const option = await screen.findByRole("option", { name: /Write the release notes/ });
    expect(option).toHaveTextContent("Takenkanban");
    expect(option).toHaveTextContent("Board");
    expect(option).toHaveTextContent("Todo");
    expect(option).toHaveTextContent("TKB-14");
  });

  it("marks an archived result as archived", async () => {
    tasksSearch.mockResolvedValue([hit({ archived: true })]);
    const { user } = setup();

    await user.type(screen.getByRole("combobox"), "release");

    expect(await screen.findByRole("option", { name: /archived/ })).toBeInTheDocument();
  });

  it("opens the highlighted result on Enter", async () => {
    tasksSearch.mockResolvedValue([hit()]);
    const { onOpenTask, onOpenChange, user } = setup();

    await user.type(screen.getByRole("combobox"), "release");
    await screen.findByRole("option", { name: /Write the release notes/ });
    await user.keyboard("{Enter}");

    expect(onOpenTask).toHaveBeenCalledWith(expect.objectContaining({ taskId: "t1" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("moves the highlight with the arrow keys, and wraps", async () => {
    tasksSearch.mockResolvedValue([
      hit({ taskId: "t1", title: "First" }),
      hit({ taskId: "t2", title: "Second" }),
    ]);
    const { user } = setup();

    await user.type(screen.getByRole("combobox"), "e");
    await screen.findByRole("option", { name: /First/ });

    const selected = () =>
      screen
        .getAllByRole("option")
        .findIndex((node) => node.getAttribute("aria-selected") === "true");

    expect(selected()).toBe(0);
    await user.keyboard("{ArrowDown}");
    expect(selected()).toBe(1);
    await user.keyboard("{ArrowDown}");
    expect(selected()).toBe(0);
    await user.keyboard("{ArrowUp}");
    expect(selected()).toBe(1);
  });

  it("points at the highlighted option with aria-activedescendant", async () => {
    tasksSearch.mockResolvedValue([hit()]);
    const { user } = setup();

    await user.type(screen.getByRole("combobox"), "release");
    const option = await screen.findByRole("option", { name: /Write the release notes/ });

    expect(screen.getByRole("combobox")).toHaveAttribute("aria-activedescendant", option.id);
  });

  it("shows commands before any typing, and runs the chosen one", async () => {
    const { user } = setup([settings]);

    const option = screen.getByRole("option", { name: /Open settings/ });
    expect(option).toBeInTheDocument();

    await user.click(option);
    expect(settings.run).toHaveBeenCalled();
  });

  it("narrows commands by what was typed", async () => {
    const { user } = setup([settings]);

    await user.type(screen.getByRole("combobox"), "zzz");

    await waitFor(() => {
      expect(screen.queryByRole("option", { name: /Open settings/ })).not.toBeInTheDocument();
    });
  });

  it("moves the highlight back to the top when the results change", async () => {
    tasksSearch.mockResolvedValue([
      hit({ taskId: "t1", title: "First" }),
      hit({ taskId: "t2", title: "Second" }),
    ]);
    const { user } = setup();

    await user.type(screen.getByRole("combobox"), "e");
    await screen.findByRole("option", { name: /First/ });
    await user.keyboard("{ArrowDown}");

    tasksSearch.mockResolvedValue([hit({ taskId: "t3", title: "Third" })]);
    await user.type(screen.getByRole("combobox"), "x");

    // Otherwise Enter would run whatever happened to be at the old index.
    await waitFor(() => {
      const options = screen.getAllByRole("option");
      expect(options[0]).toHaveAttribute("aria-selected", "true");
    });
  });

  it("says plainly when nothing matches", async () => {
    const { user } = setup();

    await user.type(screen.getByRole("combobox"), "nothingmatches");

    expect(await screen.findByText(/Nothing matches/)).toBeInTheDocument();
  });

  it("reports a search that failed instead of showing an empty list", async () => {
    tasksSearch.mockRejectedValue({ kind: "database", message: "the index is unreadable" });
    const { user } = setup();

    await user.type(screen.getByRole("combobox"), "release");

    expect(await screen.findByText(/index is unreadable/)).toBeInTheDocument();
  });

  it("counts the results for anyone not looking at the list", async () => {
    tasksSearch.mockResolvedValue([hit()]);
    const { user } = setup();

    await user.type(screen.getByRole("combobox"), "release");

    const status = await screen.findByRole("status");
    expect(within(status).getByText(/1 result\./)).toBeInTheDocument();
  });
});
