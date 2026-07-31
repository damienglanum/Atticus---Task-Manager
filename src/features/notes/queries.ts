import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { NotePatch } from "@/lib/bindings/NotePatch";
import { ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/query/keys";

export function useNotes(projectId: string | null) {
  return useQuery({
    queryKey: queryKeys.notes(projectId ?? ""),
    queryFn: () => ipc.notesList(projectId ?? ""),
    enabled: projectId !== null,
  });
}

export function useCreateNote(projectId: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (title: string) => ipc.noteCreate(projectId, title),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.notes(projectId) }),
  });
}

export function useUpdateNote(projectId: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: NotePatch }) => ipc.noteUpdate(id, patch),
    onSuccess: (note) => {
      // Written straight into the cached list rather than invalidated. The note
      // editor saves on a keystroke pause, and a refetch per pause would make
      // the list flicker under the cursor of the person still typing in it.
      client.setQueryData(queryKeys.notes(projectId), (current: (typeof note)[] | undefined) =>
        current?.map((existing) => (existing.id === note.id ? note : existing)),
      );
    },
  });
}

export function useDeleteNote(projectId: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => ipc.noteDelete(id),
    onSuccess: () => client.invalidateQueries({ queryKey: queryKeys.notes(projectId) }),
  });
}
