import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMutation } from "@tanstack/react-query";
import { Bell, ChevronRight, CircleHelp, LayoutGrid, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { IconButton } from "@/components/ui/Button";
import { Toaster } from "@/components/ui/Toaster";
import { HelpDialog } from "@/features/settings/HelpDialog";
import { NotesView } from "@/features/notes/NotesView";
import { NameDialog } from "@/features/profile/NameDialog";
import { useProfileName, useSetProfileName } from "@/features/profile/queries";
import { WelcomeScreen } from "@/features/profile/WelcomeScreen";
import { DashboardView, ProjectsView } from "@/features/workspace/DashboardView";
import type { WorkspaceView } from "@/features/projects/ProjectSidebar";
import { BoardNameDialog } from "@/features/boards/BoardNameDialog";
import { BoardTabs } from "@/features/boards/BoardTabs";
import {
  useBoards,
  useCreateBoard,
  useDeleteBoard,
  useMcpManagedBoards,
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
import { UpdateBanner } from "@/features/updates/UpdateBanner";
import { BoardView } from "@/features/board/BoardView";
import { CommandPalette } from "@/features/search/CommandPalette";
import { useShortcuts } from "./useShortcuts";
import { useUndoAcrossApp } from "./useUndoAcrossApp";
import { useMcpChanges } from "./useMcpChanges";
import type { Board } from "@/lib/bindings/Board";
import type { Project } from "@/lib/bindings/Project";
import type { ThemePreference } from "@/lib/bindings/ThemePreference";
import type { UpdateStatus } from "@/lib/bindings/UpdateStatus";
import { cn } from "@/lib/cn";
import { describeAppError, toAppError } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/query/keys";
import type { ProjectFormValues } from "@/lib/schemas";
import { notifyError } from "./toast";
import { applyThemePreference } from "./theme";

type ProjectDialogState =
  { mode: "closed" } | { mode: "create" } | { mode: "edit"; project: Project };

type BoardDialogState =
  { mode: "closed" } | { mode: "create"; projectId: string } | { mode: "rename"; board: Board };

export function App() {
  const client = useQueryClient();
  useMcpChanges(client);

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
  const mcpBoards = useMcpManagedBoards();
  const selectedProjectId = workspace.data?.projectId ?? null;
  const boards = useBoards(selectedProjectId);
  const selectedBoardId = workspace.data?.boardId ?? null;

  const [projectDialog, setProjectDialog] = useState<ProjectDialogState>({ mode: "closed" });
  const [boardDialog, setBoardDialog] = useState<BoardDialogState>({ mode: "closed" });
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [requestedTaskId, setRequestedTaskId] = useState<string | null>(null);
  const [renamingProfile, setRenamingProfile] = useState(false);
  const [view, setView] = useState<WorkspaceView>("board");
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ state: "idle" });
  const [updateRestarting, setUpdateRestarting] = useState(false);

  useEffect(() => {
    const lifecycle = { active: true };
    let stopListening: (() => void) | undefined;

    void (async () => {
      try {
        stopListening = await ipc.listenUpdateStatus((status) => {
          if (lifecycle.active) setUpdateStatus(status);
        });
        if (!lifecycle.active) {
          stopListening();
          return;
        }

        // The release check starts before React. Reading the backend state after
        // subscribing means a very fast download cannot lose its ready notice.
        const current = await ipc.updatesStatus();
        setUpdateStatus(current);
      } catch {
        // `npm run dev` can render the web layer outside Tauri. Updates simply
        // stay absent there; the packaged desktop build owns this feature.
      }
    })();

    return () => {
      lifecycle.active = false;
      stopListening?.();
    };
  }, []);

  const profileName = useProfileName();
  const setProfileName = useSetProfileName();

  /**
   * Dismisses the splash window once there is something worth showing.
   *
   * "Ready" is the two queries the shell cannot render without, *settled* rather
   * than successful: a database that failed to open still has a recovery screen
   * to show, and leaving somebody on a splash screen because their data is in
   * trouble is the worst possible moment to do it.
   */
  const shellSettled = !workspace.isPending && !preferences.isPending;
  useEffect(() => {
    if (shellSettled) void ipc.appReady();
  }, [shellSettled]);

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

  const { active, personalActive, personalArchived, mcpProjects } = useMemo(() => {
    const all = projects.data ?? [];
    const activeProjects = all.filter((project) => project.archivedAt === null);
    return {
      active: activeProjects,
      personalActive: activeProjects.filter((project) => !project.mcpManaged),
      personalArchived: all.filter((project) => project.archivedAt !== null && !project.mcpManaged),
      // Archived AI projects remain in their protected section so the user can
      // restore or delete them without mixing them into personal work.
      mcpProjects: all.filter((project) => project.mcpManaged),
    };
  }, [projects.data]);

  const selectedProject = active.find((project) => project.id === selectedProjectId) ?? null;

  /** What the bell reports: local signals only, nothing pushed from anywhere. */
  const attentionCount = personalActive.filter((project) => project.directoryMissing).length;

  // Startup failed entirely — the database could not be opened. This is the one
  // case where the recovery screen replaces the whole interface.
  const startupError = workspace.error ?? preferences.error;
  if (startupError !== null) {
    return <RecoveryScreen error={toAppError(startupError)} />;
  }

  // First run. Rendered before the shell rather than over it: the workspace
  // behind a welcome screen belongs to nobody yet, and showing it for a frame
  // and then covering it is worse than waiting for one query.
  if (profileName.isSuccess && profileName.data === null) {
    return (
      <>
        <WelcomeScreen
          pending={setProfileName.isPending}
          onSubmit={(name) => {
            setProfileName.mutate(name, {
              onError: (error: unknown) => {
                notifyError(`Your name could not be saved. ${describeAppError(toAppError(error))}`);
              },
            });
          }}
        />
        <Toaster />
      </>
    );
  }

  const openBoard = (board: Board) => {
    setWorkspace.mutate({ projectId: board.projectId, boardId: board.id });
    setView("board");
  };

  const openProject = (project: Project) => {
    setWorkspace.mutate({ projectId: project.id, boardId: null });
    setView("board");
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
    } else if (boardDialog.mode === "create") {
      const board = await createBoard.mutateAsync({ projectId: boardDialog.projectId, name });
      setWorkspace.mutate({ projectId: board.projectId, boardId: board.id });
      setView("board");
    }
    setBoardDialog({ mode: "closed" });
  };

  return (
    <div className="bg-surface-app text-fg-primary flex h-full">
      <ProjectSidebar
        active={personalActive}
        archived={personalArchived}
        mcpProjects={mcpProjects}
        mcpBoards={mcpBoards.data ?? []}
        selectedId={selectedProjectId}
        selectedBoardId={selectedBoardId}
        view={view}
        onNavigate={setView}
        profileName={profileName.data ?? ""}
        onRenameProfile={() => {
          setRenamingProfile(true);
        }}
        onSelect={openProject}
        onSelectMcpBoard={openBoard}
        onCreateMcpBoard={(project) => {
          setBoardDialog({ mode: "create", projectId: project.id });
        }}
        onRenameMcpBoard={(board) => {
          setBoardDialog({ mode: "rename", board });
        }}
        onDeleteMcpBoard={(board) => {
          deleteBoard.mutate(
            { id: board.id, projectId: board.projectId },
            {
              onError: (error: unknown) => {
                notifyError(describeAppError(toAppError(error)));
              },
            },
          );
        }}
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
          <Breadcrumb
            projectName={selectedProject?.name ?? null}
            view={view}
            onHome={() => {
              setView("projects");
            }}
          />

          <div className="flex shrink-0 items-center gap-2">
            <SearchField
              onOpen={() => {
                setPaletteOpen(true);
              }}
            />

            <IconButton
              label="Keyboard shortcuts and help"
              className="size-9"
              onClick={() => {
                setHelpOpen(true);
              }}
            >
              <CircleHelp size={16} aria-hidden />
            </IconButton>

            <AttentionBell
              count={attentionCount}
              onOpen={() => {
                setView("dashboard");
              }}
            />
          </div>
        </header>

        <UpdateBanner
          status={updateStatus}
          restarting={updateRestarting}
          onRestart={() => {
            setUpdateRestarting(true);
            void ipc.updatesRestart().catch((error: unknown) => {
              setUpdateRestarting(false);
              notifyError(`Couldn't restart Atticus. ${describeAppError(toAppError(error))}`);
            });
          }}
        />

        <main className="min-h-0 flex-1">
          {workspace.isPending || projects.isPending ? (
            <p role="status" className="text-fg-secondary p-6 text-sm">
              Opening your workspace…
            </p>
          ) : view === "dashboard" ? (
            <DashboardView
              projects={personalActive}
              boards={boards.data ?? []}
              greeting={greeting(profileName.data ?? "")}
              onOpenTask={(task) => {
                setWorkspace.mutate({ projectId: task.projectId, boardId: task.boardId });
                setRequestedTaskId(task.id);
                setView("board");
              }}
            />
          ) : view === "projects" ? (
            <ProjectsView projects={personalActive} onOpen={openProject} />
          ) : view === "notes" ? (
            <NotesView projectId={selectedProjectId} projectName={selectedProject?.name ?? null} />
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
              boardName={
                boards.data?.find((board) => board.id === selectedBoardId)?.name ?? "Board"
              }
              openTaskId={requestedTaskId}
              tabs={
                boards.data !== undefined && boards.data.length > 0 ? (
                  <BoardTabs
                    boards={boards.data}
                    selectedId={selectedBoardId}
                    onSelect={openBoard}
                    onCreate={() => {
                      setBoardDialog({ mode: "create", projectId: selectedProject.id });
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

      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />

      {renamingProfile ? (
        <NameDialog
          open
          onOpenChange={setRenamingProfile}
          initialName={profileName.data ?? ""}
          pending={setProfileName.isPending}
          onSubmit={(name) => {
            setProfileName.mutate(name, {
              onSuccess: () => {
                setRenamingProfile(false);
              },
              onError: (error: unknown) => {
                notifyError(`Your name could not be saved. ${describeAppError(toAppError(error))}`);
              },
            });
          }}
        />
      ) : null}

      <Toaster />
    </div>
  );
}

/** Where you are, in one line: the sidebar's list, then whatever is open. */
function Breadcrumb({
  projectName,
  view,
  onHome,
}: {
  projectName: string | null;
  view: WorkspaceView;
  onHome: () => void;
}) {
  const leaf =
    view === "dashboard"
      ? "Dashboard"
      : view === "notes"
        ? projectName === null
          ? "Notes"
          : `${projectName} · Notes`
        : view === "projects"
          ? null
          : projectName;

  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="text-fg-secondary flex items-center gap-2 text-sm">
        <li className="shrink-0">
          <button
            type="button"
            onClick={onHome}
            className="hover:text-fg-primary flex min-h-6 cursor-default items-center gap-2"
          >
            <LayoutGrid size={14} aria-hidden />
            Projects
          </button>
        </li>
        {leaf === null ? null : (
          <li className="flex min-w-0 items-center gap-2">
            <ChevronRight size={14} aria-hidden className="text-fg-secondary shrink-0" />
            <span className="text-fg-primary truncate font-medium">{leaf}</span>
          </li>
        )}
      </ol>
    </nav>
  );
}

/**
 * The bell.
 *
 * It reports things this machine can see for itself — right now, projects whose
 * folder has moved. Nothing is pushed to it, because there is nothing to push
 * from. A bell that could never ring would be furniture, so it is only marked
 * when it has something to say, and it says how many.
 */
function AttentionBell({ count, onOpen }: { count: number; onOpen: () => void }) {
  return (
    <IconButton
      label={
        count === 0
          ? "Nothing needs attention"
          : `${String(count)} ${count === 1 ? "thing needs" : "things need"} attention`
      }
      className="relative size-9"
      onClick={onOpen}
    >
      <Bell size={16} aria-hidden />
      {count === 0 ? null : (
        <span
          aria-hidden
          className="bg-danger-solid absolute top-1.5 right-1.5 size-2 rounded-full"
        />
      )}
    </IconButton>
  );
}

/** The dashboard's heading. Uses the name because that is what it was asked for. */
function greeting(name: string): string {
  const hour = new Date().getHours();
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const first = name.trim().split(/\s+/)[0] ?? "";
  return first === "" ? part : `${part}, ${first}`;
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
