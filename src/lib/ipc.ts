/**
 * The only module in the frontend that talks to Rust.
 *
 * Every Tauri command is named here with its argument and return types, so the
 * whole backend surface is one greppable file and component tests can mock a
 * single module. An ESLint rule forbids importing `invoke` anywhere else.
 *
 * See docs/adr/0010-generated-type-bindings.md.
 */
import { invoke } from "@tauri-apps/api/core";

import type { AppInfo } from "./bindings/AppInfo";
import type { BackupInfo } from "./bindings/BackupInfo";
import type { ExportScope } from "./bindings/ExportScope";
import type { ImportMode } from "./bindings/ImportMode";
import type { ImportPlan } from "./bindings/ImportPlan";
import type { ImportResult } from "./bindings/ImportResult";
import type { ArchiveResult } from "./bindings/ArchiveResult";
import type { Board } from "./bindings/Board";
import type { BoardPatch } from "./bindings/BoardPatch";
import type { BoardSnapshot } from "./bindings/BoardSnapshot";
import type { Column } from "./bindings/Column";
import type { ColumnDisposition } from "./bindings/ColumnDisposition";
import type { ColumnSettings } from "./bindings/ColumnSettings";
import type { FileRef } from "./bindings/FileRef";
import type { Label } from "./bindings/Label";
import type { LabelInput } from "./bindings/LabelInput";
import type { LinkRef } from "./bindings/LinkRef";
import type { MoveOutcome } from "./bindings/MoveOutcome";
import type { SavedFilter } from "./bindings/SavedFilter";
import type { SearchHit } from "./bindings/SearchHit";
import type { Subtask } from "./bindings/Subtask";
import type { SubtaskPatch } from "./bindings/SubtaskPatch";
import type { TaskDetail } from "./bindings/TaskDetail";
import type { DatabaseInfo } from "./bindings/DatabaseInfo";
import type { DeletedCounts } from "./bindings/DeletedCounts";
import type { NewProject } from "./bindings/NewProject";
import type { Note } from "./bindings/Note";
import type { NotePatch } from "./bindings/NotePatch";
import type { Preferences } from "./bindings/Preferences";
import type { Project } from "./bindings/Project";
import type { ProjectCreated } from "./bindings/ProjectCreated";
import type { ProjectPatch } from "./bindings/ProjectPatch";
import type { ResolvedTheme } from "./bindings/ResolvedTheme";
import type { NewTask } from "./bindings/NewTask";
import type { Task } from "./bindings/Task";
import type { TaskPatch } from "./bindings/TaskPatch";
import type { ThemePreference } from "./bindings/ThemePreference";
import type { UpdateStatus } from "./bindings/UpdateStatus";
import type { UndoRecord } from "./bindings/UndoRecord";
import type { Workspace } from "./bindings/Workspace";
import { IpcError, toAppError } from "./errors";

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw new IpcError(toAppError(error));
  }
}

export const ipc = {
  appInfo: () => call<AppInfo>("app_info"),
  databaseInfo: () => call<DatabaseInfo>("database_info"),
  backupCreate: () => call<string>("backup_create"),

  preferencesGet: () => call<Preferences>("preferences_get"),
  preferencesSetTheme: (theme: ThemePreference) =>
    call<Preferences>("preferences_set_theme", { theme }),
  // The titlebar is drawn by macOS from the window's own theme, not from the
  // web contents. See `window_set_theme` in Rust.
  windowSetTheme: (theme: ResolvedTheme) => call<null>("window_set_theme", { theme }),

  // Interface state the frontend owns the shape of. Every key is stored under a
  // `ui:` prefix in Rust, so this can never overwrite the workspace or theme.
  uiStateGet: (key: string) => call<string | null>("ui_state_get", { key }),
  uiStateSet: (key: string, value: string) => call<null>("ui_state_set", { key, value }),

  projectsList: (includeArchived: boolean) => call<Project[]>("projects_list", { includeArchived }),
  projectCreate: (input: NewProject) => call<ProjectCreated>("project_create", { input }),
  projectUpdate: (id: string, patch: ProjectPatch) =>
    call<Project>("project_update", { id, patch }),
  projectSetArchived: (id: string, archived: boolean) =>
    call<Project>("project_set_archived", { id, archived }),
  projectDeletePreview: (id: string) => call<DeletedCounts>("project_delete_preview", { id }),
  projectDelete: (id: string, confirmName: string) =>
    call<DeletedCounts>("project_delete", { id, confirmName }),
  projectsReorder: (orderedIds: string[]) => call<Project[]>("projects_reorder", { orderedIds }),

  boardsList: (projectId: string) => call<Board[]>("boards_list", { projectId }),
  boardCreate: (projectId: string, name: string) =>
    call<Board>("board_create", { projectId, name }),
  boardUpdate: (id: string, patch: BoardPatch) => call<Board>("board_update", { id, patch }),
  // A Rust command returning `()` resolves to `null` over IPC, not `undefined`.
  boardDelete: (id: string) => call<null>("board_delete", { id }),
  boardsReorder: (projectId: string, orderedIds: string[]) =>
    call<Board[]>("boards_reorder", { projectId, orderedIds }),

  workspaceGet: () => call<Workspace>("workspace_get"),
  workspaceSet: (workspace: Workspace) => call<Workspace>("workspace_set", { workspace }),

  boardLoad: (boardId: string) => call<BoardSnapshot>("board_load", { boardId }),
  boardArchivedTasks: (boardId: string) => call<Task[]>("board_archived_tasks", { boardId }),

  columnCreate: (boardId: string, name: string) => call<Column>("column_create", { boardId, name }),
  columnUpdate: (id: string, settings: ColumnSettings) =>
    call<Column>("column_update", { id, settings }),
  columnTaskCount: (id: string) => call<number>("column_task_count", { id }),
  columnDelete: (id: string, disposition: ColumnDisposition) =>
    call<UndoRecord>("column_delete", { id, disposition }),
  columnsReorder: (boardId: string, orderedIds: string[]) =>
    call<Column[]>("columns_reorder", { boardId, orderedIds }),

  taskCreate: (input: NewTask) => call<Task>("task_create", { input }),
  taskUpdate: (id: string, patch: TaskPatch) => call<Task>("task_update", { id, patch }),
  taskDuplicate: (id: string) => call<Task>("task_duplicate", { id }),
  taskMove: (id: string, toColumnId: string, toIndex: number) =>
    call<MoveOutcome>("task_move", { id, toColumnId, toIndex }),
  taskSetArchived: (id: string, archived: boolean) =>
    call<ArchiveResult>("task_set_archived", { id, archived }),
  taskDelete: (id: string) => call<UndoRecord>("task_delete", { id }),

  taskDetail: (id: string) => call<TaskDetail>("task_detail", { id }),

  subtaskCreate: (taskId: string, title: string) =>
    call<Subtask>("subtask_create", { taskId, title }),
  subtaskUpdate: (id: string, patch: SubtaskPatch) =>
    call<Subtask>("subtask_update", { id, patch }),
  subtaskDelete: (id: string) => call<null>("subtask_delete", { id }),
  subtasksReorder: (taskId: string, orderedIds: string[]) =>
    call<Subtask[]>("subtasks_reorder", { taskId, orderedIds }),

  labelsList: (projectId: string) => call<Label[]>("labels_list", { projectId }),
  labelCreate: (projectId: string, input: LabelInput) =>
    call<Label>("label_create", { projectId, input }),
  labelUpdate: (id: string, input: LabelInput) => call<Label>("label_update", { id, input }),
  labelUsageCount: (id: string) => call<number>("label_usage_count", { id }),
  labelDelete: (id: string) => call<UndoRecord>("label_delete", { id }),
  taskSetLabels: (taskId: string, labelIds: string[]) =>
    call<string[]>("task_set_labels", { taskId, labelIds }),

  fileRefAdd: (taskId: string, path: string) => call<FileRef>("file_ref_add", { taskId, path }),
  fileRefRelocate: (id: string, path: string) => call<FileRef>("file_ref_relocate", { id, path }),
  fileRefRemove: (id: string) => call<null>("file_ref_remove", { id }),
  fileRefsVerify: (taskId: string) => call<FileRef[]>("file_refs_verify", { taskId }),
  // Reveals in Finder by reference id — the path never crosses from the webview.
  fileRefReveal: (id: string) => call<null>("file_ref_reveal", { id }),

  linkRefAdd: (taskId: string, url: string) => call<LinkRef>("link_ref_add", { taskId, url }),
  linkRefRemove: (id: string) => call<null>("link_ref_remove", { id }),

  /**
   * Opens a link in the system browser.
   *
   * Goes through the opener plugin, which is scoped in `capabilities/default.json`
   * to http, https and mailto. The scheme is checked in the webview too — see
   * `features/board/Markdown.tsx` — because two nets beat one at a boundary
   * where a pasted string decides what happens.
   */
  openExternal: async (url: string): Promise<null> => {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
    return null;
  },

  /** The system open dialog: the only way a filesystem path enters the app. */
  pickFile: async (): Promise<string | null> => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const chosen = await open({ multiple: false, directory: false });
    return typeof chosen === "string" ? chosen : null;
  },

  /** The system open dialog, filtered to export files. */
  pickImportFile: async (): Promise<string | null> => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const chosen = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Atticus export", extensions: ["json"] }],
    });
    return typeof chosen === "string" ? chosen : null;
  },

  /** The system save dialog. Returns null when the user cancelled. */
  pickExportDestination: async (suggestedName: string): Promise<string | null> => {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const chosen = await save({
      defaultPath: suggestedName,
      filters: [{ name: "Atticus export", extensions: ["json"] }],
    });
    return typeof chosen === "string" ? chosen : null;
  },

  // Export and import move through Rust rather than the webview: the document
  // never enters the frontend, which holds no filesystem permission (ADR-0007).
  exportData: (scope: ExportScope, path: string) => call<string>("export_data", { scope, path }),
  importPreview: (path: string) => call<ImportPlan>("import_preview", { path }),
  importApply: (path: string, mode: ImportMode) =>
    call<ImportResult>("import_apply", { path, mode }),

  backupsList: () => call<BackupInfo[]>("backups_list"),
  /** Returns where the database that was replaced has been saved. */
  backupRestore: (path: string) => call<string>("backup_restore", { path }),

  /**
   * Tells the backend the interface is ready to be looked at, so the splash
   * window can go. Never rejects into the UI: a splash that fails to close is
   * bad, and an error toast on top of one is worse.
   */
  appReady: () => call<null>("app_ready").catch(() => null),

  updatesStatus: () => call<UpdateStatus>("updates_status"),
  updatesRestart: () => call<null>("updates_restart"),
  listenUpdateStatus: async (onStatus: (status: UpdateStatus) => void) => {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<UpdateStatus>("atticus://update-status", (event) => {
      onStatus(event.payload);
    });
  },

  notesList: (projectId: string) => call<Note[]>("notes_list", { projectId }),
  noteCreate: (projectId: string, title: string) => call<Note>("note_create", { projectId, title }),
  noteUpdate: (id: string, patch: NotePatch) => call<Note>("note_update", { id, patch }),
  noteDelete: (id: string) => call<null>("note_delete", { id }),

  tasksSearch: (query: string) => call<SearchHit[]>("tasks_search", { query }),

  savedFiltersList: (projectId: string) => call<SavedFilter[]>("saved_filters_list", { projectId }),
  savedFilterCreate: (projectId: string, name: string, filter: string) =>
    call<SavedFilter>("saved_filter_create", { projectId, name, filter }),
  savedFilterDelete: (id: string) => call<null>("saved_filter_delete", { id }),

  // Returns what it undid, or null when there was nothing on the stack.
  undoLast: () => call<string | null>("undo_last"),
  undoAvailable: () => call<boolean>("undo_available"),
} as const;

export type Ipc = typeof ipc;
