import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  AlertTriangle,
  Archive,
  ArrowDown,
  ArrowUp,
  CalendarClock,
  CheckSquare,
  Copy,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";

import { IconButton } from "@/components/ui/Button";
import { MenuContent, MenuItem, MenuSeparator } from "@/components/ui/Menu";
import type { BoardTask } from "@/lib/bindings/BoardTask";
import type { Column } from "@/lib/bindings/Column";
import type { Label } from "@/lib/bindings/Label";
import type { Task } from "@/lib/bindings/Task";
import { cn } from "@/lib/cn";

import { describeDue, dueState } from "./dates";
import { LabelChip } from "./LabelChip";
import { priorityLevel } from "./priority";

/** How many labels a card shows before collapsing the rest into "+n" (US-14 AC2). */
const VISIBLE_LABELS = 3;

interface TaskCardProps {
  task: BoardTask;
  projectPrefix: string;
  /** Every label in the project, so the card can name its own. */
  labels: Label[];
  /** Today, passed in so every card agrees and re-reads it together. */
  today: string;
  onOpen: (task: Task) => void;
  /** Every other column on this board, as move targets. */
  otherColumns: Column[];
  canMoveUp: boolean;
  canMoveDown: boolean;
  onRename: (task: Task) => void;
  onDuplicate: (task: Task) => void;
  onArchive: (task: Task) => void;
  onDelete: (task: Task) => void;
  onNudge: (task: Task, direction: -1 | 1) => void;
  onMoveToColumn: (task: Task, columnId: string) => void;
}

/**
 * One task on the board.
 *
 * One tab stop per card — the actions menu — rather than one per control. A
 * column of twenty tasks that cost four stops each would be unusable from the
 * keyboard, so everything a task can do lives behind that one menu.
 */
export function TaskCard({
  task,
  projectPrefix,
  labels,
  today,
  onOpen,
  otherColumns,
  canMoveUp,
  canMoveDown,
  onRename,
  onDuplicate,
  onArchive,
  onDelete,
  onNudge,
  onMoveToColumn,
}: TaskCardProps) {
  const reference = `${projectPrefix}-${String(task.number)}`;
  const priority = priorityLevel(task.priority);
  const PriorityIcon = priority.icon;
  const due = describeDue(task.dueDate, today);
  const dueTone = dueState(task.dueDate, today);

  const own = task.labelIds
    .map((id) => labels.find((label) => label.id === id))
    .filter((label): label is Label => label !== undefined);
  const shownLabels = own.slice(0, VISIBLE_LABELS);
  const hiddenLabels = own.slice(VISIBLE_LABELS);
  const hiddenLabelCount = hiddenLabels.length;
  const hiddenLabelNames = hiddenLabels.map((label) => label.name).join(", ");

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("group relative", isDragging && "opacity-40")}
    >
      <div className="border-border-subtle bg-surface-card hover:border-border-default relative overflow-hidden rounded-md border">
        {/*
        The card is a button that opens the task; dragging lives on the grip
        beside the menu. They were the same element at first, which meant
        clicking a card did nothing at all — the only way in was the actions
        menu, and nobody looks there. Splitting them costs one tab stop and buys
        the obvious gesture back: click to open, Enter to open, grip to drag.
        */}
        <button
          type="button"
          onClick={() => {
            onOpen(task);
          }}
          className="focus-visible:border-accent-border w-full cursor-default rounded-[3px] border border-transparent bg-transparent px-3.5 py-3 pr-12 text-left"
          data-task-card
          data-task-id={task.id}
        >
          <div
            aria-hidden
            className="text-fg-secondary mb-2 flex items-center gap-2 pr-7 font-mono text-2xs"
          >
            <span data-numeric>{reference}</span>
            <span aria-hidden className="bg-accent-solid h-px w-4 opacity-70" />
            <span aria-hidden className="bg-border-subtle h-px min-w-3 flex-1" />
          </div>

          {shownLabels.length === 0 ? null : (
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {shownLabels.map((label) => (
                <LabelChip key={label.id} label={label} />
              ))}
              {hiddenLabelCount === 0 ? null : (
                <span
                  className="text-fg-secondary text-2xs"
                  title={hiddenLabelNames}
                  aria-label={`and ${String(hiddenLabelCount)} more: ${hiddenLabelNames}`}
                >
                  +{hiddenLabelCount}
                </span>
              )}
            </div>
          )}

          <p
            data-task-title
            className="text-fg-primary line-clamp-2 text-base font-medium break-words"
            // The full text is available on hover for a title the card clamps.
            title={task.title}
          >
            {task.title}
          </p>

          {/*
          Two lines of the description, which is what makes a card scannable
          without opening it. Clamped rather than truncated at a character
          count: a count picked in the editor is wrong at every other column
          width, and the board's columns are deliberately elastic.
        */}
          {task.description.trim() === "" ? null : (
            <p className="text-fg-secondary mt-1 line-clamp-2 text-sm break-words">
              {task.description}
            </p>
          )}

          <div className="text-fg-secondary mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs">
            {task.priority > 0 ? (
              <span className={cn("flex items-center gap-0.5", priority.tone)}>
                <PriorityIcon size={11} aria-hidden />
                {priority.label}
              </span>
            ) : null}

            {due === "" ? null : (
              <span
                className={cn(
                  "flex items-center gap-0.5",
                  dueTone === "overdue"
                    ? "text-danger-fg"
                    : dueTone === "today" || dueTone === "soon"
                      ? "text-warning-fg"
                      : undefined,
                )}
              >
                <CalendarClock size={11} aria-hidden />
                {due}
              </span>
            )}

            {task.subtaskCount > 0 ? (
              <span
                className="flex items-center gap-0.5"
                aria-label={`${String(task.subtasksDone)} of ${String(task.subtaskCount)} subtasks done`}
              >
                <CheckSquare size={11} aria-hidden />
                <span data-numeric>
                  {task.subtasksDone}/{task.subtaskCount}
                </span>
              </span>
            ) : null}

            {task.hasMissingFile ? (
              <span className="text-warning-fg flex items-center gap-0.5">
                <AlertTriangle size={11} aria-hidden />
                Missing file
              </span>
            ) : null}
          </div>
        </button>

        <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5">
          <IconButton
            {...attributes}
            {...listeners}
            label={`Drag ${task.title}`}
            className="text-fg-secondary cursor-grab opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
          >
            <GripVertical size={13} aria-hidden />
          </IconButton>

          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <IconButton
                label={`Actions for ${task.title}`}
                // Dimmed rather than hidden. A control revealed only on hover does
                // not exist for a touch user, and a mouse user has to discover it by
                // accident; keeping it present at low contrast costs little on a
                // dense board and keeps the affordance honest.
                className="text-fg-secondary opacity-60 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
              >
                <MoreHorizontal size={14} aria-hidden />
              </IconButton>
            </DropdownMenu.Trigger>

            <DropdownMenu.Portal>
              <MenuContent>
                <MenuItem
                  onSelect={() => {
                    onOpen(task);
                  }}
                >
                  <Pencil size={13} aria-hidden />
                  Open
                </MenuItem>
                <MenuItem
                  onSelect={() => {
                    onRename(task);
                  }}
                >
                  <Pencil size={13} aria-hidden />
                  Rename
                </MenuItem>

                <MenuSeparator />

                {/*
              Movement without dragging. Not a fallback for people who cannot
              drag — it is the primary path for anyone on a keyboard, and it is
              the reason drag is never the only way to move a task.
            */}
                <MenuItem
                  disabled={!canMoveUp}
                  onSelect={() => {
                    onNudge(task, -1);
                  }}
                >
                  <ArrowUp size={13} aria-hidden />
                  Move up
                </MenuItem>
                <MenuItem
                  disabled={!canMoveDown}
                  onSelect={() => {
                    onNudge(task, 1);
                  }}
                >
                  <ArrowDown size={13} aria-hidden />
                  Move down
                </MenuItem>

                {otherColumns.length > 0 ? (
                  <>
                    <MenuSeparator />
                    <p className="text-fg-secondary px-2 pt-1 pb-0.5 text-2xs">Move to column</p>
                    {otherColumns.map((column) => (
                      <MenuItem
                        key={column.id}
                        onSelect={() => {
                          onMoveToColumn(task, column.id);
                        }}
                      >
                        {column.name}
                      </MenuItem>
                    ))}
                  </>
                ) : null}

                <MenuSeparator />
                <MenuItem
                  onSelect={() => {
                    onDuplicate(task);
                  }}
                >
                  <Copy size={13} aria-hidden />
                  Duplicate
                </MenuItem>
                <MenuItem
                  onSelect={() => {
                    onArchive(task);
                  }}
                >
                  <Archive size={13} aria-hidden />
                  Archive
                </MenuItem>
                <MenuSeparator />
                <MenuItem
                  destructive
                  onSelect={() => {
                    onDelete(task);
                  }}
                >
                  <Trash2 size={13} aria-hidden />
                  Delete
                </MenuItem>
              </MenuContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>
    </li>
  );
}
