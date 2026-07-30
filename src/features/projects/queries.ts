import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";

import type { NewProject } from "@/lib/bindings/NewProject";
import type { ProjectPatch } from "@/lib/bindings/ProjectPatch";
import { ipc } from "@/lib/ipc";
import { projectScopedKeys, queryKeys } from "@/lib/query/keys";

/**
 * Anything that changes a project can change which boards exist and which
 * workspace resolves, so all three families are invalidated together. One
 * helper rather than scattered `invalidateQueries` calls: the set of things
 * affected by a project mutation is a fact about the domain, stated once.
 */
async function invalidateProjectScope(client: QueryClient): Promise<void> {
  await Promise.all(projectScopedKeys.map((key) => client.invalidateQueries({ queryKey: [key] })));
}

export function useProjects(includeArchived: boolean) {
  return useQuery({
    queryKey: queryKeys.projects(includeArchived),
    queryFn: () => ipc.projectsList(includeArchived),
  });
}

export function useCreateProject() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: NewProject) => ipc.projectCreate(input),
    onSuccess: () => invalidateProjectScope(client),
  });
}

export function useUpdateProject() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ProjectPatch }) =>
      ipc.projectUpdate(id, patch),
    onSuccess: () => invalidateProjectScope(client),
  });
}

export function useSetProjectArchived() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      ipc.projectSetArchived(id, archived),
    onSuccess: () => invalidateProjectScope(client),
  });
}

export function useDeleteProject() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, confirmName }: { id: string; confirmName: string }) =>
      ipc.projectDelete(id, confirmName),
    onSuccess: () => invalidateProjectScope(client),
  });
}
