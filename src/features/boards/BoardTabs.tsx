import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";

import { IconButton } from "@/components/ui/Button";
import type { Board } from "@/lib/bindings/Board";
import { cn } from "@/lib/cn";

interface BoardTabsProps {
  boards: Board[];
  selectedId: string | null;
  onSelect: (board: Board) => void;
  onCreate: () => void;
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

  return (
    <div className="flex items-center gap-1" role="tablist" aria-label="Boards">
      {boards.map((board) => {
        const selected = board.id === selectedId;
        return (
          <div key={board.id} className="group relative flex items-center">
            <button
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => {
                onSelect(board);
              }}
              className={cn(
                "cursor-default rounded-md py-1 pr-6 pl-2 text-xs",
                selected
                  ? "bg-accent-bg text-accent-fg font-medium"
                  : "text-fg-secondary hover:bg-surface-sunken hover:text-fg-primary",
              )}
            >
              {board.name}
            </button>

            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <IconButton
                  label={`Actions for ${board.name}`}
                  className="absolute right-0 size-5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                >
                  <MoreHorizontal size={12} aria-hidden />
                </IconButton>
              </DropdownMenu.Trigger>

              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="start"
                  sideOffset={4}
                  style={{ zIndex: "var(--z-dropdown)" }}
                  className="bg-surface-raised border-border-default min-w-40 rounded-md border p-1 shadow-(--shadow-overlay)"
                >
                  <DropdownMenu.Item
                    onSelect={() => {
                      onRename(board);
                    }}
                    className="text-fg-primary data-highlighted:bg-surface-sunken flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-none"
                  >
                    <Pencil size={13} aria-hidden />
                    Rename board…
                  </DropdownMenu.Item>

                  {canDelete ? (
                    <DropdownMenu.Item
                      onSelect={() => {
                        onDelete(board);
                      }}
                      className="text-danger-fg data-highlighted:bg-danger-bg flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-none"
                    >
                      <Trash2 size={13} aria-hidden />
                      Delete board…
                    </DropdownMenu.Item>
                  ) : null}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        );
      })}

      <IconButton label="New board" onClick={onCreate}>
        <Plus size={14} aria-hidden />
      </IconButton>
    </div>
  );
}
