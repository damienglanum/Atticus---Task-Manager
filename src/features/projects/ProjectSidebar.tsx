import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Archive,
  ArchiveRestore,
  Bot,
  ChevronRight,
  ChevronsUpDown,
  FileText,
  FolderX,
  LayoutDashboard,
  LayoutGrid,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings,
  Settings2,
  Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";

import { Button, IconButton } from "@/components/ui/Button";
import { Wordmark } from "@/components/ui/Logo";
import { MenuContent, MenuItem, MenuSeparator } from "@/components/ui/Menu";
import { initialsOf } from "@/features/profile/queries";
import { cn } from "@/lib/cn";
import type { Board } from "@/lib/bindings/Board";
import type { Project } from "@/lib/bindings/Project";
import { colorVariable } from "./colors";

/** The workspace-level destinations, as distinct from an individual project. */
export type WorkspaceView = "dashboard" | "projects" | "notes" | "board";

interface ProjectSidebarProps {
  active: Project[];
  archived: Project[];
  mcpProjects: Project[];
  mcpBoards: Board[];
  selectedId: string | null;
  selectedBoardId: string | null;
  view: WorkspaceView;
  onNavigate: (view: WorkspaceView) => void;
  profileName: string;
  onRenameProfile: () => void;
  onSelect: (project: Project) => void;
  onSelectMcpBoard: (board: Board) => void;
  onCreateMcpBoard: (project: Project) => void;
  onRenameMcpBoard: (board: Board) => void;
  onDeleteMcpBoard: (board: Board) => void;
  onCreate: () => void;
  onEdit: (project: Project) => void;
  onArchive: (project: Project, archived: boolean) => void;
  onDelete: (project: Project) => void;
  onOpenSettings: () => void;
}

/** A section heading in the sidebar. Small caps, and never a control. */
function SectionLabel({ children }: { children: string }) {
  return (
    <h2 className="text-fg-secondary px-2 text-2xs font-semibold tracking-[0.08em] uppercase">
      {children}
    </h2>
  );
}

function NavItem({
  icon: Icon,
  label,
  selected,
  onSelect,
}: {
  icon: LucideIcon;
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-current={selected ? "page" : undefined}
        onClick={onSelect}
        className={cn(
          "flex w-full cursor-default items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm",
          selected
            ? "bg-accent-bg text-accent-fg font-medium"
            : "text-fg-secondary hover:bg-surface-sunken hover:text-fg-primary",
        )}
      >
        <Icon size={15} aria-hidden className="shrink-0" />
        {label}
      </button>
    </li>
  );
}

export function ProjectSidebar({
  active,
  archived,
  mcpProjects,
  mcpBoards,
  selectedId,
  selectedBoardId,
  view,
  onNavigate,
  profileName,
  onRenameProfile,
  onSelect,
  onSelectMcpBoard,
  onCreateMcpBoard,
  onRenameMcpBoard,
  onDeleteMcpBoard,
  onCreate,
  onEdit,
  onArchive,
  onDelete,
  onOpenSettings,
}: ProjectSidebarProps) {
  const [showArchived, setShowArchived] = useState(false);
  const [showMcpBoards, setShowMcpBoards] = useState(true);
  const mcpSelection = mcpProjects.some((project) => project.id === selectedId);

  return (
    <nav
      aria-label="Workspace"
      className="border-border-subtle bg-surface-column flex w-64 shrink-0 flex-col border-r"
    >
      <div className="flex h-14 shrink-0 items-center px-4">
        <Wordmark />
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <div className="mb-1.5 pt-1">
          <SectionLabel>Workspace</SectionLabel>
        </div>
        <ul className="space-y-0.5">
          <NavItem
            icon={LayoutDashboard}
            label="Dashboard"
            selected={view === "dashboard"}
            onSelect={() => {
              onNavigate("dashboard");
            }}
          />
          <NavItem
            icon={LayoutGrid}
            label="My Projects"
            // The board belongs to a project, so it lights this up too: a
            // sidebar that highlights nothing while you are looking at a board
            // makes the board feel like it is outside the application.
            selected={view === "projects" || (view === "board" && !mcpSelection)}
            onSelect={() => {
              onNavigate("projects");
            }}
          />
          <NavItem
            icon={FileText}
            label="Notes"
            selected={view === "notes"}
            onSelect={() => {
              onNavigate("notes");
            }}
          />
        </ul>

        <div className="mt-5 mb-1.5 flex items-center justify-between gap-2 px-2">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="text-fg-secondary text-2xs font-semibold tracking-[0.08em] uppercase">
              Projects
            </h2>
            {active.length > 0 ? (
              <span data-numeric className="text-fg-secondary text-2xs">
                {active.length}
              </span>
            ) : null}
          </div>
          <IconButton label="New project" onClick={onCreate}>
            <Plus size={15} aria-hidden />
          </IconButton>
        </div>

        {active.length === 0 ? (
          <EmptyState onCreate={onCreate} />
        ) : (
          <ul className="space-y-0.5">
            {active.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                selected={project.id === selectedId && view === "board"}
                onSelect={onSelect}
                onEdit={onEdit}
                onArchive={onArchive}
                onDelete={onDelete}
              />
            ))}
          </ul>
        )}

        <div className="mt-4">
          <button
            type="button"
            onClick={() => {
              setShowMcpBoards((value) => !value);
            }}
            aria-expanded={showMcpBoards}
            className={cn(
              "flex w-full cursor-default items-center gap-2 rounded-md px-2 py-2 text-left",
              "text-fg-secondary hover:bg-surface-sunken hover:text-fg-primary",
              mcpSelection ? "bg-accent-bg text-accent-fg" : "",
            )}
          >
            <ChevronRight
              size={12}
              aria-hidden
              className={cn(
                "transition-transform duration-(--duration-fast)",
                showMcpBoards ? "rotate-90" : "",
              )}
            />
            <Bot size={14} aria-hidden className="shrink-0" />
            <span className="flex-1 text-2xs font-semibold tracking-[0.08em] uppercase">
              AI Boards
            </span>
            <Lock size={11} aria-label="Protected AI workspace" className="shrink-0" />
            <span data-numeric className="text-2xs">
              {mcpBoards.length}
            </span>
          </button>

          {showMcpBoards ? (
            <div className="border-accent-border bg-accent-bg/35 mt-1 rounded-lg border p-1.5">
              <p className="text-accent-fg px-1.5 py-1 text-2xs leading-relaxed">
                AI can write here only. Your projects stay protected.
              </p>

              {mcpProjects.length === 0 ? (
                <p className="text-fg-secondary px-1.5 py-2 text-xs">
                  Boards created through MCP will appear here.
                </p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {mcpProjects.map((project) => {
                    const projectBoards = mcpBoards.filter(
                      (board) => board.projectId === project.id,
                    );
                    return (
                      <li key={project.id}>
                        <div className="rounded-md">
                          <ProjectRow
                            project={project}
                            managed
                            selected={
                              project.id === selectedId &&
                              view === "board" &&
                              selectedBoardId === null
                            }
                            onSelect={onSelect}
                            onEdit={onEdit}
                            onArchive={onArchive}
                            onDelete={onDelete}
                            asListItem={false}
                          />
                          {projectBoards.length === 0 ? null : (
                            <ul className="border-accent-border ml-4 space-y-0.5 border-l pl-1.5">
                              {projectBoards.map((board) => {
                                const selected = board.id === selectedBoardId && view === "board";
                                return (
                                  <li key={board.id} className="group/board relative">
                                    <button
                                      type="button"
                                      aria-label={`${board.name} in ${project.name}`}
                                      aria-current={selected ? "page" : undefined}
                                      onClick={() => {
                                        onSelectMcpBoard(board);
                                      }}
                                      className={cn(
                                        "flex w-full cursor-default items-center gap-2 rounded-md py-1.5 pr-8 pl-2 text-left text-xs",
                                        selected
                                          ? "bg-accent-solid text-on-solid font-medium"
                                          : "text-fg-secondary hover:bg-surface-card hover:text-fg-primary",
                                      )}
                                    >
                                      <LayoutGrid size={12} aria-hidden className="shrink-0" />
                                      <span className="truncate">{board.name}</span>
                                    </button>

                                    <DropdownMenu.Root>
                                      <DropdownMenu.Trigger asChild>
                                        <IconButton
                                          label={`Actions for board ${board.name}`}
                                          className="absolute top-1/2 right-0.5 -translate-y-1/2 opacity-60 group-hover/board:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                                        >
                                          <MoreHorizontal size={12} aria-hidden />
                                        </IconButton>
                                      </DropdownMenu.Trigger>
                                      <DropdownMenu.Portal>
                                        <MenuContent align="start" className="min-w-40">
                                          <MenuItem
                                            onSelect={() => {
                                              onRenameMcpBoard(board);
                                            }}
                                          >
                                            <Pencil size={13} aria-hidden />
                                            Rename board…
                                          </MenuItem>
                                          {projectBoards.length > 1 ? (
                                            <MenuItem
                                              destructive
                                              onSelect={() => {
                                                onDeleteMcpBoard(board);
                                              }}
                                            >
                                              <Trash2 size={13} aria-hidden />
                                              Delete board…
                                            </MenuItem>
                                          ) : null}
                                        </MenuContent>
                                      </DropdownMenu.Portal>
                                    </DropdownMenu.Root>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                          {project.archivedAt === null ? (
                            <button
                              type="button"
                              aria-label={`Add board to ${project.name}`}
                              onClick={() => {
                                onCreateMcpBoard(project);
                              }}
                              className="text-fg-secondary hover:bg-surface-card hover:text-fg-primary ml-4 mt-1 flex w-[calc(100%-1rem)] cursor-default items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-2xs"
                            >
                              <Plus size={11} aria-hidden />
                              Add board
                            </button>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : null}
        </div>

        {archived.length > 0 ? (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => {
                setShowArchived((value) => !value);
              }}
              aria-expanded={showArchived}
              className="text-fg-secondary hover:bg-surface-sunken hover:text-fg-primary flex w-full cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-2xs font-semibold tracking-[0.08em] uppercase"
            >
              <ChevronRight
                size={12}
                aria-hidden
                className={cn(
                  "transition-transform duration-(--duration-fast)",
                  showArchived ? "rotate-90" : "",
                )}
              />
              <span className="flex-1 text-left">Archived</span>
              <span data-numeric>{archived.length}</span>
            </button>

            {showArchived ? (
              <ul className="mt-1 space-y-0.5">
                {archived.map((project) => (
                  <ProjectRow
                    key={project.id}
                    project={project}
                    selected={false}
                    onSelect={onSelect}
                    onEdit={onEdit}
                    onArchive={onArchive}
                    onDelete={onDelete}
                  />
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="border-border-subtle shrink-0 border-t p-2">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className="text-fg-primary hover:bg-surface-sunken flex w-full cursor-default items-center gap-2.5 rounded-md px-2 py-2 text-left"
            >
              {/*
                Initials, not a photograph. There is no account to carry an
                avatar and nowhere to upload one to; a coloured disc with two
                letters is honest about being generated from the name.
              */}
              <span
                aria-hidden
                className="bg-accent-solid text-on-solid flex size-7 shrink-0 items-center justify-center rounded-full text-2xs font-semibold"
              >
                {initialsOf(profileName)}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{profileName}</span>
              <ChevronsUpDown size={14} aria-hidden className="text-fg-secondary shrink-0" />
            </button>
          </DropdownMenu.Trigger>

          <DropdownMenu.Portal>
            <MenuContent align="start" side="top" className="min-w-52">
              <MenuItem onSelect={onRenameProfile}>
                <Pencil size={13} aria-hidden />
                Change your name…
              </MenuItem>
            </MenuContent>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        <button
          type="button"
          onClick={onOpenSettings}
          className="text-fg-secondary hover:bg-surface-sunken hover:text-fg-primary flex w-full cursor-default items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm"
        >
          <Settings size={15} aria-hidden className="shrink-0" />
          Settings
        </button>
      </div>
    </nav>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="px-2 py-5">
      <p className="text-fg-primary text-sm font-medium">No projects yet</p>
      <p className="text-fg-secondary mt-1.5 text-xs">
        A project holds boards, columns, and tasks. Most people start with one per repository.
      </p>
      {/* Deliberately not "New project": the header already has a control with
          that name, and two buttons announcing the same name is a genuine
          nuisance for anyone navigating by voice or by screen reader. */}
      <Button variant="primary" size="sm" className="mt-3" onClick={onCreate}>
        <Plus size={12} aria-hidden />
        Create your first project
      </Button>
    </div>
  );
}

interface ProjectRowProps {
  project: Project;
  managed?: boolean;
  selected: boolean;
  onSelect: (project: Project) => void;
  onEdit: (project: Project) => void;
  onArchive: (project: Project, archived: boolean) => void;
  onDelete: (project: Project) => void;
  asListItem?: boolean;
}

function ProjectRow({
  project,
  managed = false,
  selected,
  onSelect,
  onEdit,
  onArchive,
  onDelete,
  asListItem = true,
}: ProjectRowProps) {
  const isArchived = project.archivedAt !== null;
  const Root = asListItem ? "li" : "div";

  return (
    <Root className="group relative">
      <button
        type="button"
        aria-label={project.name}
        aria-current={selected ? "true" : undefined}
        onClick={() => {
          onSelect(project);
        }}
        className={cn(
          "flex w-full cursor-default items-center gap-2.5 rounded-md py-1.5 pr-8 pl-2 text-left",
          "transition-colors duration-(--duration-fast)",
          selected
            ? "bg-accent-bg text-accent-fg"
            : "text-fg-secondary hover:bg-surface-sunken hover:text-fg-primary",
          isArchived ? "opacity-70" : "",
        )}
      >
        <span
          aria-hidden
          className="h-7 w-0.5 shrink-0 rounded-full"
          style={{ backgroundColor: colorVariable(project.color) }}
        />
        <span className="min-w-0 flex-1">
          <span className={cn("block truncate text-sm", selected ? "font-medium" : "")}>
            {project.name}
          </span>
          <span
            data-numeric
            className={cn(
              "block truncate font-mono text-2xs",
              selected ? "text-accent-fg" : "text-fg-secondary",
            )}
          >
            {managed ? "AI · " : ""}
            {project.keyPrefix}
          </span>
        </span>
        {project.directoryMissing ? (
          <FolderX
            size={12}
            aria-label="Project directory is missing"
            className="text-warning-fg shrink-0"
          />
        ) : null}
      </button>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <IconButton
            label={`Actions for ${project.name}`}
            className="absolute top-1/2 right-1 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreHorizontal size={14} aria-hidden />
          </IconButton>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <MenuContent>
            <MenuItem
              onSelect={() => {
                onEdit(project);
              }}
            >
              <Settings2 size={13} aria-hidden />
              Project settings…
            </MenuItem>

            <MenuItem
              onSelect={() => {
                onArchive(project, !isArchived);
              }}
            >
              {isArchived ? (
                <>
                  <ArchiveRestore size={13} aria-hidden />
                  Restore project
                </>
              ) : (
                <>
                  <Archive size={13} aria-hidden />
                  Archive project
                </>
              )}
            </MenuItem>

            <MenuSeparator />

            <MenuItem
              destructive
              onSelect={() => {
                onDelete(project);
              }}
            >
              <Trash2 size={13} aria-hidden />
              Delete project…
            </MenuItem>
          </MenuContent>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </Root>
  );
}
