import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  MoreHorizontal,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react";
import { useRef } from "react";

import { IconButton } from "@/components/ui/Button";
import { MenuContent, MenuItem, MenuSeparator } from "@/components/ui/Menu";
import type { BoardTask } from "@/lib/bindings/BoardTask";
import type { Column } from "@/lib/bindings/Column";
import type { Label } from "@/lib/bindings/Label";
import type { Task } from "@/lib/bindings/Task";
import { cn } from "@/lib/cn";

import { QuickComposer } from "./QuickComposer";
import { TaskCard } from "./TaskCard";

interface BoardColumnProps {
  column: Column;
  tasks: BoardTask[];
  projectPrefix: string;
  canDelete: boolean;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  /** Every other column on the board, offered as move targets on each card. */
  otherColumns: Column[];
  /** Every label in the project, so cards can name their own. */
  labels: Label[];
  today: string;
  /** Owned by the board, so the header's "New task" can open this one. */
  composing: boolean;
  onComposingChange: (composing: boolean) => void;
  onOpenTask: (task: Task) => void;
  onCreateTask: (columnId: string, title: string) => void;
  onEditColumn: (column: Column) => void;
  onMoveColumn: (column: Column, direction: -1 | 1) => void;
  onDeleteColumn: (column: Column) => void;
  onRenameTask: (task: Task) => void;
  onDuplicateTask: (task: Task) => void;
  onArchiveTask: (task: Task) => void;
  onDeleteTask: (task: Task) => void;
  onNudgeTask: (task: Task, direction: -1 | 1) => void;
  onMoveTaskToColumn: (task: Task, columnId: string) => void;
}

export function BoardColumn({
  column,
  tasks,
  projectPrefix,
  canDelete,
  canMoveLeft,
  canMoveRight,
  otherColumns,
  labels,
  today,
  composing,
  onComposingChange,
  onOpenTask,
  onCreateTask,
  onEditColumn,
  onMoveColumn,
  onDeleteColumn,
  onRenameTask,
  onDuplicateTask,
  onArchiveTask,
  onDeleteTask,
  onNudgeTask,
  onMoveTaskToColumn,
}: BoardColumnProps) {
  const addButtonRef = useRef<HTMLButtonElement>(null);

  // The column itself is a drop target, so a task can be dropped into an empty
  // column or below the last card rather than only onto another card.
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  const overLimit = column.wipLimit !== null && tasks.length > column.wipLimit;
  const headingId = `column-heading-${column.id}`;

  return (
    <section
      aria-labelledby={headingId}
      ref={setNodeRef}
      className={cn(
        // The lane fills the board before it scrolls, but never becomes too
        // narrow to read or absurdly wide. Five lanes fit a wide workspace now
        // that Add column no longer consumes its own lane.
        "bg-surface-column flex min-w-[16.25rem] max-w-96 flex-1 shrink-0 basis-64 flex-col rounded-sm border-x border-b border-t-2",
        // Three signals for a breached limit, only one of which is colour: a
        // heavier border, a warning glyph, and the count itself (US-7 AC2).
        overLimit
          ? "border-x-warning-border border-b-warning-border border-t-warning-fg"
          : "border-border-subtle border-t-border-default",
        isOver && "bg-surface-sunken",
      )}
    >
      <header className="border-border-subtle flex items-center gap-2 border-b px-3.5 py-3">
        {overLimit ? (
          <AlertTriangle size={13} aria-hidden className="text-warning-fg shrink-0" />
        ) : null}

        <h3
          id={headingId}
          className="text-fg-primary truncate text-xs font-semibold tracking-[0.06em] uppercase"
        >
          {column.name}
        </h3>

        <span
          className={cn(
            "shrink-0 font-mono text-2xs",
            overLimit ? "text-warning-fg font-semibold" : "text-fg-secondary",
          )}
          data-numeric
        >
          {column.wipLimit === null
            ? tasks.length
            : `${String(tasks.length)}/${String(column.wipLimit)}`}
        </span>

        <div className="ml-auto flex items-center gap-0.5">
          <IconButton
            ref={addButtonRef}
            label={`Add a task to ${column.name}`}
            onClick={() => {
              onComposingChange(true);
            }}
          >
            <Plus size={15} aria-hidden />
          </IconButton>

          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <IconButton label={`Actions for ${column.name}`}>
                <MoreHorizontal size={14} aria-hidden />
              </IconButton>
            </DropdownMenu.Trigger>

            <DropdownMenu.Portal>
              <MenuContent className="min-w-52">
                <MenuItem
                  onSelect={() => {
                    onEditColumn(column);
                  }}
                >
                  <Settings2 size={13} aria-hidden />
                  Rename and set a limit
                </MenuItem>

                <MenuSeparator />

                {/*
                  Columns are reorderable from the keyboard from the start.
                  Pointer dragging arrives in the next milestone; this is not a
                  stand-in for it — a menu command is what makes the board
                  reorderable without a mouse at all.
                */}
                <MenuItem
                  disabled={!canMoveLeft}
                  onSelect={() => {
                    onMoveColumn(column, -1);
                  }}
                >
                  <ArrowLeft size={13} aria-hidden />
                  Move left
                </MenuItem>
                <MenuItem
                  disabled={!canMoveRight}
                  onSelect={() => {
                    onMoveColumn(column, 1);
                  }}
                >
                  <ArrowRight size={13} aria-hidden />
                  Move right
                </MenuItem>

                <MenuSeparator />

                <MenuItem
                  destructive
                  disabled={!canDelete}
                  onSelect={() => {
                    onDeleteColumn(column);
                  }}
                >
                  <Trash2 size={13} aria-hidden />
                  Delete column
                </MenuItem>
                {canDelete ? null : (
                  // Says why rather than leaving a dead-looking control (US-6 AC5).
                  <p className="text-fg-secondary px-2 pt-0.5 pb-1 text-2xs">
                    A board needs at least one column.
                  </p>
                )}
              </MenuContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </header>

      {overLimit ? (
        // Announced politely rather than shown only in colour, so the breach
        // reaches a screen-reader user too (US-7 AC3).
        <p role="status" className="sr-only">
          {`${column.name} is over its limit, ${String(tasks.length)} of ${String(column.wipLimit ?? 0)}`}
        </p>
      ) : null}

      <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
        <ul className="flex flex-1 flex-col gap-2 overflow-y-auto px-2.5 py-2.5">
          {tasks.map((task, index) => (
            <TaskCard
              key={task.id}
              task={task}
              projectPrefix={projectPrefix}
              labels={labels}
              today={today}
              onOpen={onOpenTask}
              otherColumns={otherColumns}
              canMoveUp={index > 0}
              canMoveDown={index < tasks.length - 1}
              onRename={onRenameTask}
              onDuplicate={onDuplicateTask}
              onArchive={onArchiveTask}
              onDelete={onDeleteTask}
              onNudge={onNudgeTask}
              onMoveToColumn={onMoveTaskToColumn}
            />
          ))}
        </ul>
      </SortableContext>

      {composing ? (
        <QuickComposer
          columnName={column.name}
          onCreate={(title) => {
            onCreateTask(column.id, title);
          }}
          onClose={() => {
            onComposingChange(false);
            // Focus goes back where it came from, so Escape does not strand a
            // keyboard user at the top of the document (US-9 AC2).
            addButtonRef.current?.focus();
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            onComposingChange(true);
          }}
          className="border-border-subtle text-fg-secondary hover:bg-surface-sunken hover:text-fg-primary mx-2.5 mb-2.5 flex cursor-default items-center gap-2 border-t px-1 py-2.5 text-left text-sm"
        >
          <Plus size={14} aria-hidden />
          Add a task
        </button>
      )}
    </section>
  );
}
