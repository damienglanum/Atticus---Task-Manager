import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";

import { IconButton } from "@/components/ui/Button";
import { MenuContent, MenuItem } from "@/components/ui/Menu";
import type { Board } from "@/lib/bindings/Board";
import { cn } from "@/lib/cn";

interface BoardTabsProps {
  boards: Board[];
  selectedId: string | null;
  onSelect: (board: Board) => void;
  /** Omitted for an AI-managed project: MCP is the only board creator there. */
  onCreate?: () => void;
  onRename: (board: Board) => void;
  onDelete: (board: Board) => void;
}

/**
 * Boards within a project.
 *
 * A tablist rather than buttons, so arrow keys move between boards and the
 * current one is announced as selected. Delete is absent from the menu — not
 * disabled — when only one board remains: an action that can never succeed
 * should not be offered.
 */
export function BoardTabs({
  boards,
  selectedId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: BoardTabsProps) {
  const canDelete = boards.length > 1;

  const selectedBoard = boards.find((board) => board.id === selectedId) ?? null;

  return (
    <div className="flex items-center gap-1">
      {/* Only tabs live in here.

          The actions menu and "New board" used to sit inside the tablist, which
          gave it three tab stops: a tablist owns tabs and nothing else, and Tab
          landed inside this one repeatedly instead of moving past it. Found by
          the keyboard-order assertion in `e2e/specs/accessibility.e2e.ts` on its
          first run. */}
      <div className="flex items-center gap-1" role="tablist" aria-label="Boards">
        {boards.map((board) => {
          const selected = board.id === selectedId;
          return (
            <button
              key={board.id}
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => {
                onSelect(board);
              }}
              className={cn(
                "cursor-default rounded-md px-2 py-1 text-xs",
                selected
                  ? "bg-accent-bg text-accent-fg font-medium"
                  : "text-fg-secondary hover:bg-surface-sunken hover:text-fg-primary",
              )}
            >
              {board.name}
            </button>
          );
        })}
      </div>

      {onCreate === undefined ? null : (
        <IconButton label="New board" onClick={onCreate}>
          <Plus size={14} aria-hidden />
        </IconButton>
      )}

      {/* One menu, acting on the board that is open.

          Previously each tab carried its own, revealed on hover — which meant
          the only pointer-free route to it was a tab stop inside the tablist.
          Renaming the board you are looking at is the whole of the use case, and
          this way the control is an ordinary, permanently visible tab stop
          rather than something that appears when the mouse passes over it. */}
      {selectedBoard === null ? null : (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <IconButton label={`Actions for ${selectedBoard.name}`}>
              <MoreHorizontal size={12} aria-hidden />
            </IconButton>
          </DropdownMenu.Trigger>

          <DropdownMenu.Portal>
            <MenuContent align="start" className="min-w-40">
              <MenuItem
                onSelect={() => {
                  onRename(selectedBoard);
                }}
              >
                <Pencil size={13} aria-hidden />
                Rename board…
              </MenuItem>

              {canDelete ? (
                <MenuItem
                  destructive
                  onSelect={() => {
                    onDelete(selectedBoard);
                  }}
                >
                  <Trash2 size={13} aria-hidden />
                  Delete board…
                </MenuItem>
              ) : null}
            </MenuContent>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
    </div>
  );
}
