import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import type { Note } from "@/lib/bindings/Note";
import type { NoteIndexItem } from "@/lib/bindings/NoteIndexItem";
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

/** The bounded cross-project index. Full note bodies remain project-scoped. */
export function useAllNotes() {
  return useQuery({
    queryKey: queryKeys.allNotes(),
    queryFn: () => ipc.notesListAll(),
  });
}

export function useCreateNote(projectId: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (title: string) => ipc.noteCreate(projectId, title),
    onSuccess: (note) => {
      cacheCreatedNote(client, note);
    },
  });
}

/** Creation from All Notes deliberately carries its owning project per call. */
export function useCreateProjectNote() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ projectId, title }: { projectId: string; title: string }) =>
      ipc.noteCreate(projectId, title),
    onSuccess: (note) => {
      cacheCreatedNote(client, note);
    },
  });
}

export function useUpdateNote() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      expectedUpdatedAt,
      patch,
    }: {
      id: string;
      expectedUpdatedAt: number;
      patch: NotePatch;
    }) => ipc.noteUpdate(id, expectedUpdatedAt, patch),
    onSuccess: (note) => {
      client.setQueryData<NoteIndexItem[]>(queryKeys.allNotes(), (current) =>
        current?.map((candidate) =>
          candidate.id === note.id ? indexItemFromNote(note) : candidate,
        ),
      );
    },
  });
}

export function useDeleteNote(projectId: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => ipc.noteDelete(id),
    onSuccess: (_result, id) => {
      client.setQueryData<Note[]>(queryKeys.notes(projectId), (current) =>
        current?.filter((note) => note.id !== id),
      );
      client.setQueryData<NoteIndexItem[]>(queryKeys.allNotes(), (current) =>
        current?.filter((note) => note.id !== id),
      );
    },
  });
}

function cacheCreatedNote(client: QueryClient, note: Note): void {
  client.setQueryData<Note[]>(queryKeys.notes(note.projectId), (current) => [
    ...(current ?? []).filter((candidate) => candidate.id !== note.id),
    note,
  ]);
  client.setQueryData<NoteIndexItem[]>(queryKeys.allNotes(), (current) =>
    current === undefined ? undefined : [...current, indexItemFromNote(note)],
  );
}

function indexItemFromNote(note: Note): NoteIndexItem {
  return {
    id: note.id,
    projectId: note.projectId,
    title: note.title,
    excerpt: Array.from(note.body).slice(0, 240).join(""),
    position: note.position,
    updatedAt: note.updatedAt,
    taskCount: note.taskIds.length,
  };
}
