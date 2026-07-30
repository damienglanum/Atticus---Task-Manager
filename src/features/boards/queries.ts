import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { BoardPatch } from "@/lib/bindings/BoardPatch";
import type { Workspace } from "@/lib/bindings/Workspace";
import { ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/query/keys";

export function useBoards(projectId: string | null) {
  return useQuery({
    queryKey: queryKeys.boards(projectId ?? ""),
    queryFn: () => ipc.boardsList(projectId ?? ""),
    enabled: projectId !== null,
  });
}

export function useWorkspace() {
  return useQuery({
    queryKey: queryKeys.workspace(),
    queryFn: () => ipc.workspaceGet(),
  });
}

export function useSetWorkspace() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (workspace: Workspace) => ipc.workspaceSet(workspace),
    onSuccess: (resolved) => {
      // The backend resolves the workspace (dropping ids that no longer exist),
      // so its answer replaces the cache rather than merely invalidating it.
      client.setQueryData(queryKeys.workspace(), resolved);
    },
  });
}

export function useCreateBoard() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, name }: { projectId: string; name: string }) =>
      ipc.boardCreate(projectId, name),
    onSuccess: (board) => client.invalidateQueries({ queryKey: queryKeys.boards(board.projectId) }),
  });
}

export function useUpdateBoard() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: BoardPatch }) => ipc.boardUpdate(id, patch),
    onSuccess: (board) => client.invalidateQueries({ queryKey: queryKeys.boards(board.projectId) }),
  });
}

export function useDeleteBoard() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; projectId: string }) => {
      await ipc.boardDelete(id);
    },
    onSuccess: (_result, variables) =>
      Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.boards(variables.projectId) }),
        client.invalidateQueries({ queryKey: queryKeys.workspace() }),
      ]),
  });
}
