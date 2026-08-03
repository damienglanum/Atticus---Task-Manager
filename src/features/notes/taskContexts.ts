import { useQueries } from "@tanstack/react-query";

import type { Board } from "@/lib/bindings/Board";
import { ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/query/keys";

export interface TaskTarget {
  id: string;
  projectId: string;
  boardId: string;
}

export interface TaskContext extends TaskTarget {
  reference: string;
  title: string;
  boardName: string;
  columnName: string;
  archived: boolean;
}

/** Loads the task context the shared note editor needs for task associations. */
export function useNoteTaskContexts(
  projectId: string | null,
  projectKeyPrefix: string | null,
  boards: Board[],
): TaskContext[] {
  const snapshots = useQueries({
    queries: boards.map((board) => ({
      queryKey: queryKeys.board(board.id),
      queryFn: () => ipc.boardLoad(board.id),
      enabled: projectId !== null,
    })),
  });
  const archives = useQueries({
    queries: boards.map((board) => ({
      queryKey: queryKeys.archivedTasks(board.id),
      queryFn: () => ipc.boardArchivedTasks(board.id),
      enabled: projectId !== null,
    })),
  });

  return boards
    .flatMap((board, index) => {
      const snapshot = snapshots[index]?.data;
      const columns = new Map(snapshot?.columns.map((column) => [column.id, column.name]) ?? []);
      const active = snapshot?.tasks ?? [];
      const archived = archives[index]?.data ?? [];

      return [...active, ...archived].map((task) => {
        const columnName = columns.get(task.columnId) ?? "Unknown status";
        return {
          id: task.id,
          projectId: task.projectId,
          boardId: task.boardId,
          reference: `${projectKeyPrefix ?? "TASK"}-${String(task.number)}`,
          title: task.title,
          boardName: board.name,
          columnName,
          archived: task.archivedAt !== null,
        };
      });
    })
    .sort((left, right) =>
      left.reference.localeCompare(right.reference, undefined, { numeric: true }),
    );
}
