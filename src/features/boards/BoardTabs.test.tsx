import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Board } from "@/lib/bindings/Board";
import { BoardTabs } from "./BoardTabs";

function makeBoard(id: string, name: string, position: number): Board {
  return { id, projectId: "p1", name, position, createdAt: 0, updatedAt: 0 };
}

function setup(boards: Board[], selectedId: string | null) {
  const handlers = {
    onSelect: vi.fn(),
    onCreate: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
  };
  render(<BoardTabs boards={boards} selectedId={selectedId} {...handlers} />);
  return handlers;
}

describe("BoardTabs", () => {
  it("exposes boards as a tablist with the open one selected", () => {
    setup([makeBoard("b1", "Board", 0), makeBoard("b2", "Ideas", 1)], "b2");

    expect(screen.getByRole("tablist", { name: "Boards" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Ideas" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Board" })).toHaveAttribute("aria-selected", "false");
  });

  it("keeps only the selected tab in the tab order", () => {
    setup([makeBoard("b1", "Board", 0), makeBoard("b2", "Ideas", 1)], "b2");

    expect(screen.getByRole("tab", { name: "Ideas" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Board" })).toHaveAttribute("tabindex", "-1");
  });

  it("omits delete entirely when only one board remains", async () => {
    setup([makeBoard("b1", "Board", 0)], "b1");

    await userEvent.click(screen.getByRole("button", { name: "Actions for Board" }));

    expect(screen.getByRole("menuitem", { name: /Rename board/ })).toBeInTheDocument();
    // Absent, not disabled: an action that can never succeed should not be offered.
    expect(screen.queryByRole("menuitem", { name: /Delete board/ })).not.toBeInTheDocument();
  });

  it("offers delete once a second board exists", async () => {
    const handlers = setup([makeBoard("b1", "Board", 0), makeBoard("b2", "Ideas", 1)], "b1");

    await userEvent.click(screen.getByRole("button", { name: "Actions for Ideas" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /Delete board/ }));

    expect(handlers.onDelete).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: "b2" }),
    );
  });

  it("reports the board the user picked", async () => {
    const handlers = setup([makeBoard("b1", "Board", 0), makeBoard("b2", "Ideas", 1)], "b1");

    await userEvent.click(screen.getByRole("tab", { name: "Ideas" }));

    expect(handlers.onSelect).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: "b2" }),
    );
  });
});
