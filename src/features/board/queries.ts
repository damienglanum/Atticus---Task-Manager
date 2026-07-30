import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { BoardSnapshot } from "@/lib/bindings/BoardSnapshot";
import type { ColumnDisposition } from "@/lib/bindings/ColumnDisposition";
import type { ColumnSettings } from "@/lib/bindings/ColumnSettings";
import type { LabelInput } from "@/lib/bindings/LabelInput";
import type { NewTask } from "@/lib/bindings/NewTask";
import type { SubtaskPatch } from "@/lib/bindings/SubtaskPatch";
import type { TaskDetail } from "@/lib/bindings/TaskDetail";
import type { TaskPatch } from "@/lib/bindings/TaskPatch";
import type { UndoRecord } from "@/lib/bindings/UndoRecord";
import { ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/query/keys";
import { moveQueue } from "@/lib/singleFlight";

import { EMPTY_FILTER, parseFilter, type BoardFilter } from "./filter";
import { applyColumnOrders, applyMove } from "./reorder";

export function useBoardSnapshot(boardId: string | null) {
  return useQuery({
    queryKey: queryKeys.board(boardId ?? ""),
    queryFn: () => ipc.boardLoad(boardId ?? ""),
    enabled: boardId !== null,
  });
}

export function useArchivedTasks(boardId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.archivedTasks(boardId ?? ""),
    queryFn: () => ipc.boardArchivedTasks(boardId ?? ""),
    enabled: boardId !== null && enabled,
  });
}

/**
 * Everything a board mutation can invalidate.
 *
 * One helper rather than a list at each call site: a mutation that forgot the
 * archived list or the undo flag would leave the interface disagreeing with the
 * database, and that is not a bug anyone finds by reading a diff.
 */
function useBoardInvalidation(boardId: string) {
  const client = useQueryClient();

  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.board(boardId) }),
      client.invalidateQueries({ queryKey: queryKeys.archivedTasks(boardId) }),
      client.invalidateQueries({ queryKey: queryKeys.undoAvailable() }),
    ]);
}

export function useUndoAvailable() {
  return useQuery({
    queryKey: queryKeys.undoAvailable(),
    queryFn: () => ipc.undoAvailable(),
  });
}

export function useCreateColumn(boardId: string) {
  const invalidate = useBoardInvalidation(boardId);
  return useMutation({
    mutationFn: (name: string) => ipc.columnCreate(boardId, name),
    onSuccess: invalidate,
  });
}

export function useUpdateColumn(boardId: string) {
  const invalidate = useBoardInvalidation(boardId);
  return useMutation({
    mutationFn: ({ id, settings }: { id: string; settings: ColumnSettings }) =>
      ipc.columnUpdate(id, settings),
    onSuccess: invalidate,
  });
}

export function useReorderColumns(boardId: string) {
  const invalidate = useBoardInvalidation(boardId);
  return useMutation({
    mutationFn: (orderedIds: string[]) => ipc.columnsReorder(boardId, orderedIds),
    onSuccess: invalidate,
  });
}

export function useDeleteColumn(boardId: string) {
  const invalidate = useBoardInvalidation(boardId);
  return useMutation({
    mutationFn: ({ id, disposition }: { id: string; disposition: ColumnDisposition }) =>
      ipc.columnDelete(id, disposition),
    onSuccess: invalidate,
  });
}

export function useCreateTask(boardId: string) {
  const invalidate = useBoardInvalidation(boardId);
  return useMutation({
    mutationFn: (input: NewTask) => ipc.taskCreate(input),
    onSuccess: invalidate,
  });
}

export function useUpdateTask(boardId: string) {
  const invalidate = useBoardInvalidation(boardId);
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: TaskPatch }) => ipc.taskUpdate(id, patch),
    onSuccess: invalidate,
  });
}

export function useDuplicateTask(boardId: string) {
  const invalidate = useBoardInvalidation(boardId);
  return useMutation({
    mutationFn: (id: string) => ipc.taskDuplicate(id),
    onSuccess: invalidate,
  });
}

export function useSetTaskArchived(boardId: string) {
  const invalidate = useBoardInvalidation(boardId);
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      ipc.taskSetArchived(id, archived),
    onSuccess: invalidate,
  });
}

/**
 * Moves a task, optimistically and one at a time.
 *
 * Three things are load-bearing here and each exists because of a specific
 * failure (ADR-0005):
 *
 * - Every move goes through `moveQueue`, so two moves can never compute their
 *   indices against a board the other is about to change.
 * - The cache is updated before the command is sent, so the card is where the
 *   user put it rather than snapping back for a round trip.
 * - `onError` restores the exact snapshot taken in `onMutate`. An optimistic
 *   update without a rollback is a lie the interface tells until the next
 *   refetch.
 */
export function useMoveTask(boardId: string) {
  const client = useQueryClient();
  const key = queryKeys.board(boardId);

  return useMutation({
    mutationFn: ({
      id,
      toColumnId,
      toIndex,
    }: {
      id: string;
      toColumnId: string;
      toIndex: number;
    }) => moveQueue.run(() => ipc.taskMove(id, toColumnId, toIndex)),

    onMutate: async ({ id, toColumnId, toIndex }) => {
      // An in-flight board load would land after the optimistic update and undo
      // it, so it is cancelled first.
      await client.cancelQueries({ queryKey: key });

      const previous = client.getQueryData<BoardSnapshot>(key);
      if (previous !== undefined) {
        client.setQueryData(key, applyMove(previous, id, toColumnId, toIndex));
      }
      return { previous };
    },

    onSuccess: (outcome) => {
      const current = client.getQueryData<BoardSnapshot>(key);
      if (current !== undefined) {
        client.setQueryData(key, applyColumnOrders(current, outcome.result.columns));
      }
      void client.invalidateQueries({ queryKey: queryKeys.undoAvailable() });
    },

    onError: (_error, _variables, context) => {
      if (context?.previous !== undefined) {
        client.setQueryData(key, context.previous);
      }
    },
  });
}

export function useDeleteTask(boardId: string) {
  const invalidate = useBoardInvalidation(boardId);
  return useMutation({
    mutationFn: (id: string) => ipc.taskDelete(id),
    onSuccess: invalidate,
  });
}

export function useUndo(boardId: string) {
  const invalidate = useBoardInvalidation(boardId);
  return useMutation({
    mutationFn: () => ipc.undoLast(),
    onSuccess: invalidate,
  });
}

/** The undo records a mutation hands back, for the toast to offer. */
export type { UndoRecord };

// --- Task detail -----------------------------------------------------------

export function useTaskDetail(taskId: string | null) {
  return useQuery({
    queryKey: queryKeys.taskDetail(taskId ?? ""),
    queryFn: () => ipc.taskDetail(taskId ?? ""),
    enabled: taskId !== null,
    // Re-verifies file references on the server each time, so a stale answer
    // about a file that has since moved is never shown.
    staleTime: 0,
  });
}

/**
 * Invalidates a task's own detail and the board it sits on.
 *
 * Both, always: a subtask toggled in the editor changes the `2/5` on the card,
 * and a label added there changes the chips. Splitting these would mean every
 * new mutation has to remember both, and one day one would not.
 */
function useDetailInvalidation(boardId: string, taskId: string) {
  const client = useQueryClient();

  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.taskDetail(taskId) }),
      client.invalidateQueries({ queryKey: queryKeys.board(boardId) }),
      client.invalidateQueries({ queryKey: queryKeys.undoAvailable() }),
    ]);
}

export function useEditTask(boardId: string, taskId: string) {
  const client = useQueryClient();
  const invalidate = useDetailInvalidation(boardId, taskId);

  return useMutation({
    mutationFn: (patch: TaskPatch) => ipc.taskUpdate(taskId, patch),
    onSuccess: (task) => {
      // The command returns the updated task, so the detail cache is corrected
      // rather than merely marked stale. Invalidating alone left the editor
      // showing the old text for the length of a refetch when it was reopened —
      // brief, but exactly the moment the user is checking whether their edit
      // was kept.
      client.setQueryData(queryKeys.taskDetail(taskId), (previous?: TaskDetail) =>
        previous === undefined ? previous : { ...previous, task },
      );
      return invalidate();
    },
  });
}

export function useCreateSubtask(boardId: string, taskId: string) {
  const invalidate = useDetailInvalidation(boardId, taskId);
  return useMutation({
    mutationFn: (title: string) => ipc.subtaskCreate(taskId, title),
    onSuccess: invalidate,
  });
}

export function useUpdateSubtask(boardId: string, taskId: string) {
  const invalidate = useDetailInvalidation(boardId, taskId);
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: SubtaskPatch }) =>
      ipc.subtaskUpdate(id, patch),
    onSuccess: invalidate,
  });
}

export function useDeleteSubtask(boardId: string, taskId: string) {
  const invalidate = useDetailInvalidation(boardId, taskId);
  return useMutation({
    mutationFn: (id: string) => ipc.subtaskDelete(id),
    onSuccess: invalidate,
  });
}

export function useSetTaskLabels(boardId: string, taskId: string) {
  const invalidate = useDetailInvalidation(boardId, taskId);
  return useMutation({
    mutationFn: (labelIds: string[]) => ipc.taskSetLabels(taskId, labelIds),
    onSuccess: invalidate,
  });
}

export function useCreateLabel(boardId: string, taskId: string, projectId: string) {
  const invalidate = useDetailInvalidation(boardId, taskId);
  return useMutation({
    mutationFn: (input: LabelInput) => ipc.labelCreate(projectId, input),
    onSuccess: invalidate,
  });
}

export function useAddFileRef(boardId: string, taskId: string) {
  const invalidate = useDetailInvalidation(boardId, taskId);
  return useMutation({
    mutationFn: (path: string) => ipc.fileRefAdd(taskId, path),
    onSuccess: invalidate,
  });
}

export function useRelocateFileRef(boardId: string, taskId: string) {
  const invalidate = useDetailInvalidation(boardId, taskId);
  return useMutation({
    mutationFn: ({ id, path }: { id: string; path: string }) => ipc.fileRefRelocate(id, path),
    onSuccess: invalidate,
  });
}

export function useRemoveFileRef(boardId: string, taskId: string) {
  const invalidate = useDetailInvalidation(boardId, taskId);
  return useMutation({
    mutationFn: (id: string) => ipc.fileRefRemove(id),
    onSuccess: invalidate,
  });
}

// --- Filters ---------------------------------------------------------------

/**
 * The board's filter, remembered across restarts (US-20).
 *
 * Stored per board rather than globally: a filter that made sense on one board
 * would silently hide work on another.
 */
export function useBoardFilter(boardId: string) {
  const client = useQueryClient();
  const key = queryKeys.boardFilter(boardId);

  const stored = useQuery({
    queryKey: key,
    queryFn: async () => {
      const raw = await ipc.uiStateGet(`filter:${boardId}`);
      if (raw === null) return EMPTY_FILTER;
      try {
        return parseFilter(JSON.parse(raw));
      } catch {
        // A filter written by another version, or a truncated write. Showing
        // everything is the safe failure: the alternative hides work.
        return EMPTY_FILTER;
      }
    },
  });

  const save = useMutation({
    mutationFn: (filter: BoardFilter) =>
      ipc.uiStateSet(`filter:${boardId}`, JSON.stringify(filter)),
  });

  return {
    filter: stored.data ?? EMPTY_FILTER,
    setFilter: (filter: BoardFilter) => {
      // Written to the cache first: a filter that lagged behind the checkbox
      // by a round trip would feel broken.
      client.setQueryData(key, filter);
      save.mutate(filter);
    },
  };
}

export function useSavedFilters(projectId: string | null) {
  return useQuery({
    queryKey: queryKeys.savedFilters(projectId ?? ""),
    queryFn: () => ipc.savedFiltersList(projectId ?? ""),
    enabled: projectId !== null,
  });
}

export function useCreateSavedFilter(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ name, filter }: { name: string; filter: BoardFilter }) =>
      ipc.savedFilterCreate(projectId, name, JSON.stringify(filter)),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.savedFilters(projectId) }),
  });
}

export function useDeleteSavedFilter(projectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => ipc.savedFilterDelete(id),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.savedFilters(projectId) }),
  });
}
