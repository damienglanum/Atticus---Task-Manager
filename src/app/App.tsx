import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMutation } from "@tanstack/react-query";
import { ChevronRight, LayoutGrid, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Toaster } from "@/components/ui/Toaster";
import { BoardNameDialog } from "@/features/boards/BoardNameDialog";
import { BoardTabs } from "@/features/boards/BoardTabs";
import {
  useBoards,
  useCreateBoard,
  useDeleteBoard,
  useSetWorkspace,
  useUpdateBoard,
  useWorkspace,
} from "@/features/boards/queries";
import { DeleteProjectDialog } from "@/features/projects/DeleteProjectDialog";
import { ProjectDialog } from "@/features/projects/ProjectDialog";
import { ProjectSidebar } from "@/features/projects/ProjectSidebar";
import {
  useCreateProject,
  useDeleteProject,
  useProjects,
  useSetProjectArchived,
  useUpdateProject,
} from "@/features/projects/queries";
import { RecoveryScreen } from "@/features/settings/RecoveryScreen";
import { SettingsDialog } from "@/features/settings/SettingsDialog";
import { BoardView } from "@/features/board/BoardView";
import { CommandPalette } from "@/features/search/CommandPalette";
import { useShortcuts } from "./useShortcuts";
import { useUndoAcrossApp } from "./useUndoAcrossApp";
import type { Board } from "@/lib/bindings/Board";
import type { Project } from "@/lib/bindings/Project";
import type { ThemePreference } from "@/lib/bindings/ThemePreference";
import { cn } from "@/lib/cn";
import { describeAppError, toAppError } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/query/keys";
import type { ProjectFormValues } from "@/lib/schemas";
import { notifyError } from "./toast";
import { applyThemePreference } from "./theme";

type ProjectDialogState =
  { mode: "closed" } | { mode: "create" } | { mode: "edit"; project: Project };

type BoardDialogState = { mode: "closed" } | { mode: "create" } | { mode: "rename"; board: Board };

export function App() {
  const client = useQueryClient();

  const preferences = useQuery({
    queryKey: queryKeys.preferences(),
    queryFn: () => ipc.preferencesGet(),
  });
  const theme: ThemePreference = preferences.data?.theme ?? "system";
  useEffect(
    () =>
      applyThemePreference(theme, (resolved) => {
        // Best-effort and deliberately unawaited: the interface has already
        // repainted, and a titlebar that stayed the wrong colour is not worth
        // a toast over the work the user was actually doing.
        void ipc.windowSetTheme(resolved).catch(() => undefined);
      }),
    [theme],
  );

  const setTheme = useMutation({
    mutationFn: (next: ThemePreference) => ipc.preferencesSetTheme(next),
    onSuccess: (updated) => {
      client.setQueryData(queryKeys.preferences(), updated);
    },
    onError: (error: unknown) => {
      notifyError(`Couldn't save the theme. ${describeAppError(toAppError(error))}`);
    },
  });

  const workspace = useWorkspace();
  const setWorkspace = useSetWorkspace();
  const projects = useProjects(true);
  const selectedProjectId = workspace.data?.projectId ?? null;
  const boards = useBoards(selectedProjectId);
  const selectedBoardId = workspace.data?.boardId ?? null;

  const [projectDialog, setProjectDialog] = useState<ProjectDialogState>({ mode: "closed" });
  const [boardDialog, setBoardDialog] = useState<BoardDialogState>({ mode: "closed" });
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [requestedTaskId, setRequestedTaskId] = useState<string | null>(null);

  const undo = useUndoAcrossApp();

  useShortcuts(
    useMemo(
      () => [
        // Allowed while typing: "search from anywhere" is the point of it.
        {
          key: "k",
          meta: true,
          whileTyping: true,
          run: () => {
            setPaletteOpen(true);
          },
        },
        // Not allowed while typing, where ⌘Z means undo the typing.
        { key: "z", meta: true, run: undo },
      ],
      [undo],
    ),
  );

  const createProject = useCreateProject();
  const updateProject = useUpdateProject();
  const setArchived = useSetProjectArchived();
  const deleteProject = useDeleteProject();
  const createBoard = useCreateBoard();
  const updateBoard = useUpdateBoard();
  const deleteBoard = useDeleteBoard();

  const { active, archived } = useMemo(() => {
    const all = projects.data ?? [];
    return {
      active: all.filter((project) => project.archivedAt === null),
      archived: all.filter((project) => project.archivedAt !== null),
    };
  }, [projects.data]);

  const selectedProject = active.find((project) => project.id === selectedProjectId) ?? null;

  // Startup failed entirely — the database could not be opened. This is the one
  // case where the recovery screen replaces the whole interface.
  const startupError = workspace.error ?? preferences.error;
  if (startupError !== null) {
    return <RecoveryScreen error={toAppError(startupError)} />;
  }

  const openBoard = (board: Board) => {
    setWorkspace.mutate({ projectId: board.projectId, boardId: board.id });
  };

  const openProject = (project: Project) => {
    setWorkspace.mutate({ projectId: project.id, boardId: null });
  };

  const submitProject = async (values: ProjectFormValues) => {
    if (projectDialog.mode === "edit") {
      await updateProject.mutateAsync({
        id: projectDialog.project.id,
        patch: {
          name: values.name,
          description: values.description,
          color: values.color,
          // Absent means "leave it alone"; the backend re-derives a prefix from
          // the name when it was never set.
          ...(values.keyPrefix === "" ? {} : { keyPrefix: values.keyPrefix }),
          directoryPath: values.directoryPath,
        },
      });
    } else {
      const created = await createProject.mutateAsync({
        name: values.name,
        description: values.description,
        color: values.color,
        ...(values.keyPrefix === "" ? {} : { keyPrefix: values.keyPrefix }),
        ...(values.directoryPath === "" ? {} : { directoryPath: values.directoryPath }),
      });
      setWorkspace.mutate({ projectId: created.project.id, boardId: created.boardId });
    }
    setProjectDialog({ mode: "closed" });
  };

  const submitBoard = async (name: string) => {
    if (boardDialog.mode === "rename") {
      await updateBoard.mutateAsync({ id: boardDialog.board.id, patch: { name } });
    } else if (selectedProjectId !== null) {
      const board = await createBoard.mutateAsync({ projectId: selectedProjectId, name });
      setWorkspace.mutate({ projectId: board.projectId, boardId: board.id });
    }
    setBoardDialog({ mode: "closed" });
  };

  return (
    <div className="bg-surface-app text-fg-primary flex h-full">
      <ProjectSidebar
        active={active}
        archived={archived}
        selectedId={selectedProjectId}
        onSelect={openProject}
        onCreate={() => {
          setProjectDialog({ mode: "create" });
        }}
        onEdit={(project) => {
          setProjectDialog({ mode: "edit", project });
        }}
        onArchive={(project, shouldArchive) => {
          setArchived.mutate(
            { id: project.id, archived: shouldArchive },
            {
              onError: (error: unknown) => {
                notifyError(describeAppError(toAppError(error)));
              },
            },
          );
        }}
        onDelete={setDeleting}
        onOpenSettings={() => {
          setSettingsOpen(true);
        }}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-border-subtle flex h-14 shrink-0 items-center justify-between gap-4 border-b px-5">
          <Breadcrumb projectName={selectedProject?.name ?? null} />

          <SearchField
            onOpen={() => {
              setPaletteOpen(true);
            }}
          />
        </header>

        <main className="min-h-0 flex-1">
          {workspace.isPending || projects.isPending ? (
            <p role="status" className="text-fg-secondary p-6 text-sm">
              Opening your workspace…
            </p>
          ) : selectedProject === null ? (
            <NoProjectYet />
          ) : selectedBoardId === null ? (
            <p className="text-fg-secondary p-6 text-sm">
              This project has no board open. Choose one above.
            </p>
          ) : (
            <BoardView
              boardId={selectedBoardId}
              projectId={selectedProject.id}
              projectPrefix={selectedProject.keyPrefix}
              projectName={selectedProject.name}
              openTaskId={requestedTaskId}
              tabs={
                boards.data !== undefined && boards.data.length > 0 ? (
                  <BoardTabs
                    boards={boards.data}
                    selectedId={selectedBoardId}
                    onSelect={openBoard}
                    onCreate={() => {
                      setBoardDialog({ mode: "create" });
                    }}
                    onRename={(board) => {
                      setBoardDialog({ mode: "rename", board });
                    }}
                    onDelete={(board) => {
                      deleteBoard.mutate(
                        { id: board.id, projectId: board.projectId },
                        {
                          onError: (error: unknown) => {
                            notifyError(describeAppError(toAppError(error)));
                          },
                        },
                      );
                    }}
                  />
                ) : null
              }
            />
          )}
        </main>
      </div>

      {projectDialog.mode !== "closed" ? (
        <ProjectDialog
          open
          onOpenChange={(open) => {
            if (!open) setProjectDialog({ mode: "closed" });
          }}
          {...(projectDialog.mode === "edit" ? { project: projectDialog.project } : {})}
          onSubmit={submitProject}
          pending={createProject.isPending || updateProject.isPending}
        />
      ) : null}

      {boardDialog.mode !== "closed" ? (
        <BoardNameDialog
          open
          onOpenChange={(open) => {
            if (!open) setBoardDialog({ mode: "closed" });
          }}
          {...(boardDialog.mode === "rename" ? { initialName: boardDialog.board.name } : {})}
          onSubmit={submitBoard}
          pending={createBoard.isPending || updateBoard.isPending}
        />
      ) : null}

      {deleting !== null ? (
        <DeleteProjectDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleting(null);
          }}
          project={deleting}
          pending={deleteProject.isPending}
          onConfirm={(confirmName) => {
            deleteProject.mutate(
              { id: deleting.id, confirmName },
              {
                onSuccess: () => {
                  setDeleting(null);
                },
                onError: (error: unknown) => {
                  notifyError(describeAppError(toAppError(error)));
                },
              },
            );
          }}
        />
      ) : null}

      {paletteOpen ? (
        <CommandPalette
          onOpenChange={setPaletteOpen}
          onOpenTask={(hit) => {
            // Switching board first, then asking the board to open the task —
            // the editor lives on the board, and a search result can be in a
            // project that is not even open.
            setWorkspace.mutate({ projectId: hit.projectId, boardId: hit.boardId });
            setRequestedTaskId(hit.taskId);
          }}
          commands={[
            {
              id: "settings",
              label: "Open settings",
              icon: "settings",
              run: () => {
                setSettingsOpen(true);
              },
            },
            {
              id: "undo",
              label: "Undo the last action",
              hint: "⌘Z",
              icon: "undo",
              run: undo,
            },
          ]}
        />
      ) : null}

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        theme={theme}
        onThemeChange={(next) => {
          setTheme.mutate(next);
        }}
        themePending={setTheme.isPending}
        projects={active}
        onDataReplaced={() => {
          // An import or a restore replaces the ids the workspace points at, so
          // the remembered selection is meaningless and would show an empty
          // board. Clearing it lets the shell fall back to whatever is there.
          setRequestedTaskId(null);
          setWorkspace.mutate({ projectId: null, boardId: null });
        }}
      />

      <Toaster />
    </div>
  );
}

/** Where you are, in one line: the sidebar's list, then the open project. */
function Breadcrumb({ projectName }: { projectName: string | null }) {
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="text-fg-secondary flex items-center gap-2 text-sm">
        <li className="flex shrink-0 items-center gap-2">
          <LayoutGrid size={14} aria-hidden />
          Projects
        </li>
        {projectName === null ? null : (
          <li className="flex min-w-0 items-center gap-2">
            <ChevronRight size={14} aria-hidden className="text-fg-secondary shrink-0" />
            <span className="text-fg-primary truncate font-medium">{projectName}</span>
          </li>
        )}
      </ol>
    </nav>
  );
}

/**
 * The search affordance in the header.
 *
 * A button wearing a text field's clothes, not a text field. Typing here would
 * mean two places that search — this one and the palette it opens — and the
 * second would have to inherit the first one's half-typed query to avoid
 * swallowing keystrokes. One search, entered one way, reached from two places.
 */
function SearchField({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "border-border-subtle bg-surface-column text-fg-secondary hover:border-border-default",
        "flex h-9 w-72 max-w-[40vw] shrink-0 cursor-default items-center gap-2 rounded-lg border px-3 text-sm",
        "transition-colors duration-(--duration-fast)",
      )}
    >
      <Search size={14} aria-hidden className="shrink-0" />
      <span className="truncate">Search tasks…</span>
      {/* Secondary rather than the muted step: this is a shortcut a user is
          meant to read and remember, and the muted step is reserved for the
          disabled states whose contrast floor WCAG exempts. */}
      <kbd className="border-border-subtle text-fg-secondary ml-auto shrink-0 rounded border px-1.5 py-0.5 font-sans text-2xs">
        ⌘K
      </kbd>
    </button>
  );
}

function NoProjectYet() {
  return (
    <div className="mx-auto max-w-md p-6 pt-16 text-center">
      <h2 className="text-xl font-semibold">Start with a project</h2>
      <p className="text-fg-secondary mt-2 text-sm">
        Each project gets its own boards, columns, labels, and task numbering. Create one from the
        sidebar to begin.
      </p>
    </div>
  );
}
