import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useQuery } from "@tanstack/react-query";
import { Archive, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { notifyError, notifyUndoable } from "@/app/toast";
import type { Column } from "@/lib/bindings/Column";
import type { ColumnDisposition } from "@/lib/bindings/ColumnDisposition";
import type { BoardTask } from "@/lib/bindings/BoardTask";
import type { Task } from "@/lib/bindings/Task";
import type { UndoRecord } from "@/lib/bindings/UndoRecord";
import { messageFor } from "@/lib/errors";
import { ipc } from "@/lib/ipc";

import { ArchivePanel } from "./ArchivePanel";
import { BoardColumn } from "./BoardColumn";
import { boardAnnouncements, screenReaderInstructions } from "./dragAnnouncements";
import { FilterBar } from "./FilterBar";
import { isFiltering, matches, parseFilter } from "./filter";
import { SaveFilterDialog } from "./SaveFilterDialog";
import { dropTarget, tasksInColumn } from "./reorder";
import { useToday } from "./useToday";
import { ColumnSettingsDialog } from "./ColumnSettingsDialog";
import { DeleteColumnDialog } from "./DeleteColumnDialog";
import { RenameTaskDialog } from "./RenameTaskDialog";
import { TaskEditor } from "./TaskEditor";
import {
  useBoardSnapshot,
  useBoardFilter,
  useCreateColumn,
  useCreateSavedFilter,
  useCreateTask,
  useDeleteSavedFilter,
  useDeleteColumn,
  useDeleteTask,
  useDuplicateTask,
  useMoveTask,
  useReorderColumns,
  useSetTaskArchived,
  useUndo,
  useSavedFilters,
  useUpdateColumn,
  useUpdateTask,
} from "./queries";

interface BoardViewProps {
  boardId: string;
  projectId: string;
  projectPrefix: string;
  /** Set by the command palette when a search result is chosen. */
  openTaskId?: string | null;
}

export function BoardView({
  boardId,
  projectId,
  projectPrefix,
  openTaskId: requestedTaskId = null,
}: BoardViewProps) {
  const snapshot = useBoardSnapshot(boardId);

  const [editing, setEditing] = useState<Column | null>(null);
  const [columnDialogOpen, setColumnDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<Column | null>(null);
  const [renaming, setRenaming] = useState<Task | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [savingFilter, setSavingFilter] = useState(false);
  const today = useToday();

  const { filter, setFilter } = useBoardFilter(boardId);
  const savedFilters = useSavedFilters(projectId);
  const createSavedFilter = useCreateSavedFilter(projectId);
  const deleteSavedFilter = useDeleteSavedFilter(projectId);

  // A task chosen in the palette opens here. Adjusted during render rather than
  // in an effect, so the editor is open in the same paint that switched the
  // board — an effect would show the board for a frame first.
  const [lastRequested, setLastRequested] = useState<string | null>(null);
  if (requestedTaskId !== null && requestedTaskId !== lastRequested) {
    setLastRequested(requestedTaskId);
    setOpenTaskId(requestedTaskId);
  }
  const [archiveOpen, setArchiveOpen] = useState(false);

  const createColumn = useCreateColumn(boardId);
  const updateColumn = useUpdateColumn(boardId);
  const reorderColumns = useReorderColumns(boardId);
  const deleteColumn = useDeleteColumn(boardId);
  const updateTask = useUpdateTask(boardId);
  const createTask = useCreateTask(boardId);
  const duplicateTask = useDuplicateTask(boardId);
  const setArchived = useSetTaskArchived(boardId);
  const deleteTask = useDeleteTask(boardId);
  const moveTask = useMoveTask(boardId);
  const undo = useUndo(boardId);

  const [dragging, setDragging] = useState<Task | null>(null);

  // Pointer drag needs a small threshold or it swallows clicks on the card's
  // own controls; keyboard drag uses dnd-kit's sortable coordinate getter so
  // arrow keys step between positions rather than by pixels.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Only fetched once a column is actually being deleted, and only for that
  // column: the dialog has to state a real number, and a number cached from
  // earlier could be wrong by the time it is read.
  const taskCount = useQuery({
    queryKey: ["column-task-count", deleting?.id ?? ""],
    queryFn: () => ipc.columnTaskCount(deleting?.id ?? ""),
    enabled: deleting !== null,
    gcTime: 0,
  });

  const tasksByColumn = useMemo(() => {
    const grouped = new Map<string, BoardTask[]>();
    for (const task of snapshot.data?.tasks ?? []) {
      const existing = grouped.get(task.columnId);
      if (existing) existing.push(task);
      else grouped.set(task.columnId, [task]);
    }

    // Sorted by position, not left in array order. `board_load` happens to
    // return tasks already ordered, which made the array order look like the
    // real one — but an optimistic move rewrites `position` in place without
    // moving anything in the array, so a within-column move committed to the
    // database while the board went on showing the old order.
    for (const tasks of grouped.values()) {
      tasks.sort((left, right) => left.position - right.position);
    }

    return grouped;
  }, [snapshot.data]);

  const visibleByColumn = useMemo(() => {
    if (!isFiltering(filter)) return tasksByColumn;

    const filtered = new Map<string, BoardTask[]>();
    for (const [columnId, tasks] of tasksByColumn) {
      filtered.set(
        columnId,
        tasks.filter((task) => matches(task, filter, today)),
      );
    }
    return filtered;
  }, [tasksByColumn, filter, today]);

  const totalTasks = snapshot.data?.tasks.length ?? 0;
  const matchingTasks = [...visibleByColumn.values()].reduce((sum, tasks) => sum + tasks.length, 0);

  function offerUndo(record: UndoRecord) {
    notifyUndoable(record.description, () => {
      undo.mutate(undefined, {
        onError: (error) => {
          notifyError(messageFor(error));
        },
      });
    });
  }

  function reportFailure(error: unknown) {
    notifyError(messageFor(error));
  }

  /**
   * Closes the editor and puts focus back on the card that opened it.
   *
   * Radix restores focus itself, but only if its dialog is still mounted when
   * it closes — and this one is unmounted the moment `openTaskId` clears, so
   * focus was landing on `<body>` and a keyboard user was dropped at the top of
   * the document. Restoring it here is the W3C APG requirement, and it is done
   * after paint because the card has to exist again first.
   */
  function closeEditor() {
    const wasOpen = openTaskId;
    setOpenTaskId(null);
    if (wasOpen === null) return;

    requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(`[data-task-id="${wasOpen}"]`)?.focus();
    });
  }

  function requestMove(task: Task, toColumnId: string, toIndex: number) {
    moveTask.mutate(
      { id: task.id, toColumnId, toIndex },
      {
        onSuccess: (outcome) => {
          if (outcome.undo !== null) offerUndo(outcome.undo);
        },
        onError: (error: unknown) => {
          notifyError(`“${task.title}” could not be moved. ${messageFor(error)}`);
        },
      },
    );
  }

  function handleDragStart(event: DragStartEvent) {
    const task = snapshot.data?.tasks.find((each) => each.id === String(event.active.id));
    setDragging(task ?? null);
  }

  /**
   * The single write of a drag (ADR-0005).
   *
   * Nothing is persisted while the pointer moves; a cancelled drag issues no
   * command at all, which is why `onDragCancel` only clears the overlay.
   */
  function handleDragEnd(event: DragEndEvent) {
    setDragging(null);

    const board = snapshot.data;
    if (board === undefined || event.over === null) return;

    const target = dropTarget(board, String(event.active.id), String(event.over.id));
    if (target === null) return;

    const task = board.tasks.find((each) => each.id === String(event.active.id));
    if (task === undefined) return;

    requestMove(task, target.columnId, target.index);
  }

  /** Moves a task one place up or down inside its own column. */
  function nudgeTask(task: Task, direction: -1 | 1) {
    requestMove(task, task.columnId, task.position + direction);
  }

  /** Sends a task to the end of another column. */
  function moveTaskToColumn(task: Task, columnId: string) {
    const destination =
      snapshot.data === undefined ? 0 : tasksInColumn(snapshot.data, columnId).length;
    requestMove(task, columnId, destination);
  }

  /**
   * Moves a column one place left or right.
   *
   * The whole order is sent, not "swap these two": the backend rewrites the
   * scope to the sequence it is given and refuses anything that is not a
   * permutation of what exists, which is what makes a concurrent change fail
   * loudly instead of corrupting the order.
   */
  function moveColumn(column: Column, direction: -1 | 1) {
    const order = (snapshot.data?.columns ?? []).map((each) => each.id);
    const from = order.indexOf(column.id);
    const to = from + direction;
    if (from === -1 || to < 0 || to >= order.length) return;

    const [moved] = order.splice(from, 1);
    if (moved === undefined) return;
    order.splice(to, 0, moved);

    reorderColumns.mutate(order, { onError: reportFailure });
  }

  if (snapshot.isPending) {
    return <BoardSkeleton />;
  }

  if (snapshot.isError) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md space-y-3 text-center">
          <h2 className="text-fg-primary text-sm font-semibold">This board could not be loaded</h2>
          <p className="text-fg-secondary text-xs">{messageFor(snapshot.error)}</p>
          <Button
            onClick={() => {
              void snapshot.refetch();
            }}
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const columns = snapshot.data.columns;
  const canDeleteColumns = columns.length > 1;

  return (
    <div className="relative flex h-full flex-col">
      <FilterBar
        filter={filter}
        onChange={setFilter}
        columns={columns}
        labels={snapshot.data.labels}
        savedFilters={savedFilters.data ?? []}
        matching={matchingTasks}
        total={totalTasks}
        onSave={() => {
          setSavingFilter(true);
        }}
        onApplySaved={(saved) => {
          try {
            setFilter(parseFilter(JSON.parse(saved.filter)));
          } catch {
            notifyError(`The saved filter “${saved.name}” could not be read.`);
          }
        }}
        onDeleteSaved={(saved) => {
          deleteSavedFilter.mutate(saved.id, { onError: reportFailure });
        }}
      />

      {savingFilter ? (
        <SaveFilterDialog
          pending={createSavedFilter.isPending}
          onOpenChange={setSavingFilter}
          onSave={(name) => {
            createSavedFilter.mutate(
              { name, filter },
              {
                onSuccess: () => {
                  setSavingFilter(false);
                },
                onError: reportFailure,
              },
            );
          }}
        />
      ) : null}

      <div className="relative min-h-0 flex-1">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          accessibility={{
            screenReaderInstructions,
            announcements: boardAnnouncements(() => snapshot.data),
          }}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => {
            setDragging(null);
          }}
        >
          <div className="flex h-full gap-3 overflow-x-auto p-3">
            {columns.map((column, index) => (
              <BoardColumn
                key={column.id}
                column={column}
                tasks={visibleByColumn.get(column.id) ?? []}
                projectPrefix={projectPrefix}
                canDelete={canDeleteColumns}
                canMoveLeft={index > 0}
                canMoveRight={index < columns.length - 1}
                onCreateTask={(columnId, title) => {
                  createTask.mutate({ columnId, title }, { onError: reportFailure });
                }}
                onEditColumn={(target) => {
                  setEditing(target);
                  setColumnDialogOpen(true);
                }}
                onMoveColumn={moveColumn}
                onDeleteColumn={setDeleting}
                onRenameTask={setRenaming}
                onDuplicateTask={(task) => {
                  duplicateTask.mutate(task.id, { onError: reportFailure });
                }}
                onArchiveTask={(task) => {
                  setArchived.mutate(
                    { id: task.id, archived: true },
                    {
                      onSuccess: (result) => {
                        offerUndo(result.undo);
                      },
                      onError: reportFailure,
                    },
                  );
                }}
                onDeleteTask={(task) => {
                  deleteTask.mutate(task.id, { onSuccess: offerUndo, onError: reportFailure });
                }}
                otherColumns={columns.filter((other) => other.id !== column.id)}
                labels={snapshot.data.labels}
                today={today}
                onOpenTask={(task) => {
                  setOpenTaskId(task.id);
                }}
                onNudgeTask={nudgeTask}
                onMoveTaskToColumn={moveTaskToColumn}
              />
            ))}

            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setColumnDialogOpen(true);
              }}
              className="border-border-subtle text-fg-tertiary hover:border-border-default hover:text-fg-secondary flex h-fit w-56 shrink-0 cursor-default items-center gap-1.5 rounded-lg border border-dashed px-3 py-2.5 text-left text-xs"
            >
              <Plus size={14} aria-hidden />
              Add a column
            </button>
          </div>

          <DragOverlay dropAnimation={null}>
            {dragging === null ? null : (
              <div className="border-accent-border bg-surface-raised w-[17rem] rounded-md border px-2.5 py-2 shadow-(--shadow-overlay)">
                <p className="text-fg-primary line-clamp-3 text-xs leading-snug break-words">
                  {dragging.title}
                </p>
                <p className="text-fg-tertiary mt-1.5 font-mono text-2xs" data-numeric>
                  {projectPrefix}-{dragging.number}
                </p>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      </div>

      {snapshot.data.archivedCount > 0 ? (
        <button
          type="button"
          onClick={() => {
            setArchiveOpen(true);
          }}
          className="border-border-subtle bg-surface-raised text-fg-secondary hover:text-fg-primary absolute right-3 bottom-3 flex cursor-default items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs"
        >
          <Archive size={13} aria-hidden />
          {snapshot.data.archivedCount} archived
        </button>
      ) : null}

      {archiveOpen ? (
        <ArchivePanel
          boardId={boardId}
          projectPrefix={projectPrefix}
          pending={setArchived.isPending}
          onOpenChange={setArchiveOpen}
          onRestore={(task) => {
            setArchived.mutate(
              { id: task.id, archived: false },
              {
                onSuccess: (result) => {
                  offerUndo(result.undo);
                },
                onError: reportFailure,
              },
            );
          }}
        />
      ) : null}

      {openTaskId === null ? null : (
        <TaskEditor
          key={openTaskId}
          taskId={openTaskId}
          boardId={boardId}
          projectPrefix={projectPrefix}
          onOpenChange={(open) => {
            if (!open) closeEditor();
          }}
        />
      )}

      {renaming === null ? null : (
        <RenameTaskDialog
          key={renaming.id}
          task={renaming}
          pending={updateTask.isPending}
          onOpenChange={(open) => {
            if (!open) setRenaming(null);
          }}
          onSave={(id, title) => {
            updateTask.mutate(
              { id, patch: { title } },
              {
                onSuccess: () => {
                  setRenaming(null);
                },
                onError: reportFailure,
              },
            );
          }}
        />
      )}

      {columnDialogOpen ? (
        <ColumnSettingsDialog
          key={editing?.id ?? "new-column"}
          column={editing}
          onOpenChange={setColumnDialogOpen}
          pending={createColumn.isPending || updateColumn.isPending}
          onCreate={(name) => {
            createColumn.mutate(name, {
              onSuccess: () => {
                setColumnDialogOpen(false);
              },
              onError: reportFailure,
            });
          }}
          onSave={(id, name, wipLimit) => {
            updateColumn.mutate(
              { id, settings: { name, wipLimit } },
              {
                onSuccess: () => {
                  setColumnDialogOpen(false);
                },
                onError: reportFailure,
              },
            );
          }}
        />
      ) : null}

      {deleting === null ? null : (
        <DeleteColumnDialog
          key={deleting.id}
          column={deleting}
          otherColumns={columns.filter((column) => column.id !== deleting.id)}
          taskCount={taskCount.data}
          countFailed={taskCount.isError}
          pending={deleteColumn.isPending}
          onOpenChange={(open) => {
            if (!open) setDeleting(null);
          }}
          onConfirm={(disposition: ColumnDisposition) => {
            deleteColumn.mutate(
              { id: deleting.id, disposition },
              {
                onSuccess: (record) => {
                  setDeleting(null);
                  offerUndo(record);
                },
                onError: reportFailure,
              },
            );
          }}
        />
      )}
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex h-full gap-3 p-3" aria-hidden>
      {[0, 1, 2, 3].map((index) => (
        <div
          key={index}
          className="bg-surface-column border-border-subtle h-40 w-72 shrink-0 rounded-lg border"
        />
      ))}
      <p className="sr-only" role="status">
        Loading the board
      </p>
    </div>
  );
}
