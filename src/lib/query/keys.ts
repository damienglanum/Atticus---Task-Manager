/**
 * Every query key in the application, in one place.
 *
 * Keys are built here rather than inline so that an invalidation and the query
 * it is meant to invalidate cannot drift apart — the commonest way a cache goes
 * stale is two slightly different literal arrays. See ADR-0011.
 */
export const queryKeys = {
  appInfo: () => ["app-info"] as const,
  databaseInfo: () => ["database-info"] as const,
  backups: () => ["backups"] as const,
  preferences: () => ["preferences"] as const,
  workspace: () => ["workspace"] as const,
  projects: (includeArchived: boolean) => ["projects", { includeArchived }] as const,
  boards: (projectId: string) => ["boards", projectId] as const,
  board: (boardId: string) => ["board", boardId] as const,
  archivedTasks: (boardId: string) => ["archived-tasks", boardId] as const,
  undoAvailable: () => ["undo-available"] as const,
  taskDetail: (taskId: string) => ["task-detail", taskId] as const,
  labels: (projectId: string) => ["labels", projectId] as const,
  search: (query: string) => ["search", query] as const,
  savedFilters: (projectId: string) => ["saved-filters", projectId] as const,
  boardFilter: (boardId: string) => ["board-filter", boardId] as const,
} as const;

/** Everything that a project mutation can invalidate. */
export const projectScopedKeys = ["projects", "boards", "workspace"] as const;
