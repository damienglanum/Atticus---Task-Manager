import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Archive,
  ArchiveRestore,
  Bot,
  ChevronRight,
  ChevronsUpDown,
  Columns3,
  FileText,
  Folder,
  FolderX,
  LayoutDashboard,
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
import { LogoMark, Wordmark } from "@/components/ui/Logo";
import { MenuContent, MenuItem, MenuSeparator } from "@/components/ui/Menu";
import { initialsOf } from "@/features/profile/queries";
import { cn } from "@/lib/cn";
import type { Board } from "@/lib/bindings/Board";
import type { Project } from "@/lib/bindings/Project";
import { colorVariable, labelColorVariable } from "./colors";

/** The workspace-level destinations, as distinct from an individual project. */
export type WorkspaceView = "dashboard" | "projects" | "notes" | "board";

interface ProjectSidebarProps {
  active: Project[];
  archived: Project[];
  aiAccessEnabled: boolean;
  mcpProjects: Project[];
  mcpBoards: Board[];
  selectedId: string | null;
  selectedBoardId: string | null;
  notesProjectId: string | null;
  view: WorkspaceView;
  onNavigate: (view: WorkspaceView) => void;
  profileName: string;
  onRenameProfile: () => void;
  onSelect: (project: Project) => void;
  onOpenProjectNotes: (project: Project) => void;
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
    <h2 className="text-fg-secondary text-2xs font-semibold tracking-[0.11em] uppercase">
      {children}
    </h2>
  );
}

function WorkspaceLink({
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
          "group/nav focus-visible:outline-focus-ring flex h-9 w-full cursor-default items-center gap-3 rounded-md px-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-offset-2",
          selected
            ? "bg-surface-column text-fg-primary font-medium"
            : "text-fg-secondary hover:bg-surface-column hover:text-fg-primary",
        )}
      >
        <span
          className={cn(
            "flex size-5 shrink-0 items-center justify-center transition-colors",
            selected ? "text-accent-fg" : "text-fg-secondary group-hover/nav:text-fg-primary",
          )}
        >
          <Icon size={16} strokeWidth={1.75} aria-hidden />
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </button>
    </li>
  );
}

export function ProjectSidebar({
  active,
  archived,
  aiAccessEnabled,
  mcpProjects,
  mcpBoards,
  selectedId,
  selectedBoardId,
  notesProjectId,
  view,
  onNavigate,
  profileName,
  onRenameProfile,
  onSelect,
  onOpenProjectNotes,
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
  const mcpSelection = mcpProjects.some((project) => project.id === selectedId);
  const personalSelection = active.some((project) => project.id === selectedId);
  const [showArchived, setShowArchived] = useState(false);
  const [showMcpBoards, setShowMcpBoards] = useState(mcpSelection || mcpProjects.length > 0);
  const [expansionOverride, setExpansionOverride] = useState<{
    selectedId: string | null;
    expandedId: string | null;
  } | null>(null);
  const expandedProjectId =
    expansionOverride?.selectedId === selectedId
      ? expansionOverride.expandedId
      : personalSelection
        ? selectedId
        : null;

  return (
    <nav
      aria-label="Workspace"
      className="border-border-subtle bg-surface-sidebar relative isolate flex w-64 shrink-0 flex-col overflow-hidden border-r"
    >
      <LogoMark
        size={196}
        className="text-accent-fg pointer-events-none absolute -right-24 bottom-24 -z-10 opacity-[0.055]"
      />

      <div className="border-border-subtle flex h-20 shrink-0 items-center border-b px-5">
        <Wordmark />
      </div>

      <div className="relative z-10 flex-1 space-y-5 overflow-y-auto px-3 py-5">
        <section className="border-border-subtle border-b pb-5">
          <div className="mb-2 px-3">
            <SectionLabel>Workspace</SectionLabel>
          </div>
          <ul className="space-y-1">
            <WorkspaceLink
              icon={LayoutDashboard}
              label="Dashboard"
              selected={view === "dashboard"}
              onSelect={() => {
                onNavigate("dashboard");
              }}
            />
            <WorkspaceLink
              icon={FileText}
              label="All Notes"
              selected={view === "notes" && notesProjectId === null}
              onSelect={() => {
                onNavigate("notes");
              }}
            />
          </ul>
        </section>

        <section>
          <div className="mb-2 flex h-7 items-center justify-between gap-2 px-3">
            <div className="flex min-w-0 items-center gap-2">
              <Folder size={13} strokeWidth={1.75} aria-hidden className="text-fg-secondary" />
              <SectionLabel>Projects</SectionLabel>
              {active.length > 0 ? (
                <span
                  data-numeric
                  className="bg-surface-column text-fg-secondary inline-flex min-w-6 items-center justify-center rounded-full px-1.5 py-0.5 font-mono text-[9px]"
                >
                  {String(active.length)}
                </span>
              ) : null}
            </div>
            <IconButton label="New project" onClick={onCreate} className="size-7">
              <Plus size={15} aria-hidden />
            </IconButton>
          </div>

          {active.length === 0 ? (
            <EmptyState onCreate={onCreate} />
          ) : (
            <ul className="space-y-1.5">
              {active.map((project) => {
                const expanded = expandedProjectId === project.id;
                const activeDestination =
                  project.id !== selectedId
                    ? null
                    : view === "board"
                      ? "board"
                      : view === "notes" && notesProjectId === project.id
                        ? "notes"
                        : null;
                return (
                  <ProjectBranch
                    key={project.id}
                    project={project}
                    expanded={expanded}
                    activeDestination={activeDestination}
                    onToggle={() => {
                      setExpansionOverride({
                        selectedId,
                        expandedId: expanded ? null : project.id,
                      });
                    }}
                    onOpenBoard={() => {
                      // Keep the clicked branch open during the short interval
                      // before the persisted workspace selection comes back.
                      // Once `selectedId` changes, the selected project becomes
                      // the source of truth again and this override expires.
                      setExpansionOverride({ selectedId, expandedId: project.id });
                      onSelect(project);
                    }}
                    onOpenNotes={() => {
                      setExpansionOverride({ selectedId, expandedId: project.id });
                      onOpenProjectNotes(project);
                    }}
                    onEdit={onEdit}
                    onArchive={onArchive}
                    onDelete={onDelete}
                  />
                );
              })}
            </ul>
          )}
        </section>

        {aiAccessEnabled ? (
          <section className="border-border-subtle border-y">
            <button
              type="button"
              onClick={() => {
                setShowMcpBoards((value) => !value);
              }}
              aria-expanded={showMcpBoards}
              className={cn(
                "grid w-full cursor-default grid-cols-[1.25rem_minmax(0,1fr)_auto_auto_auto] items-center gap-2 border-l-2 px-2 py-2.5 text-left",
                "text-fg-secondary hover:bg-surface-sunken hover:text-fg-primary",
                mcpSelection
                  ? "border-accent-solid bg-surface-sunken/55 text-fg-primary"
                  : "border-transparent",
              )}
            >
              <Bot
                size={14}
                strokeWidth={1.75}
                aria-hidden
                className={cn("shrink-0", mcpSelection ? "text-accent-fg" : "")}
              />
              <span className="text-2xs font-semibold tracking-[0.08em] uppercase">AI Boards</span>
              <Lock size={11} aria-label="Protected AI workspace" className="shrink-0" />
              <span data-numeric className="font-mono text-[9px]">
                {String(mcpBoards.length).padStart(2, "0")}
              </span>
              <ChevronRight
                size={12}
                aria-hidden
                className={cn(showMcpBoards ? "rotate-90" : "")}
              />
            </button>

            {showMcpBoards ? (
              <div className="border-border-subtle border-t">
                {mcpProjects.length === 0 ? (
                  <div className="px-3 py-3">
                    <p className="text-fg-primary text-xs font-medium">No AI boards yet</p>
                    <p className="text-fg-secondary mt-0.5 text-2xs">Created through MCP.</p>
                  </div>
                ) : (
                  <ul className="divide-border-subtle divide-y">
                    {mcpProjects.map((project) => {
                      const projectBoards = mcpBoards.filter(
                        (board) => board.projectId === project.id,
                      );
                      return (
                        <li key={project.id}>
                          <div>
                            <CompactProjectRow
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
                              <ul className="border-border-subtle ml-3 border-l">
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
                                          "flex w-full cursor-default items-center gap-2 border-l-2 py-2 pr-8 pl-2.5 text-left text-xs",
                                          selected
                                            ? "border-accent-solid bg-surface-sunken/55 text-fg-primary font-medium"
                                            : "border-transparent text-fg-secondary hover:bg-surface-sunken hover:text-fg-primary",
                                        )}
                                      >
                                        <span
                                          aria-hidden
                                          className="border-border-default h-px w-2 shrink-0 border-t"
                                        />
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
                                className="text-fg-secondary hover:bg-surface-sunken hover:text-fg-primary ml-3 flex w-[calc(100%-0.75rem)] cursor-default items-center gap-1.5 border-l-2 border-transparent px-2.5 py-2 text-left text-2xs"
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

                <p className="border-border-subtle text-fg-secondary flex items-start gap-1.5 border-t px-3 py-2 text-[9px] leading-relaxed">
                  <Lock size={10} aria-hidden className="mt-0.5 shrink-0" />
                  <span>AI can write here only. Your projects stay protected.</span>
                </p>
              </div>
            ) : null}
          </section>
        ) : null}

        {archived.length > 0 ? (
          <section className="border-border-subtle border-y">
            <button
              type="button"
              onClick={() => {
                setShowArchived((value) => !value);
              }}
              aria-expanded={showArchived}
              className="text-fg-secondary hover:bg-surface-sunken hover:text-fg-primary grid w-full cursor-default grid-cols-[1.25rem_minmax(0,1fr)_auto_auto] items-center gap-2 border-l-2 border-transparent px-2 py-2.5 text-2xs font-semibold tracking-[0.08em] uppercase"
            >
              <Archive size={13} strokeWidth={1.75} aria-hidden />
              <span className="text-left">Archived</span>
              <span data-numeric className="font-mono text-[9px]">
                {String(archived.length).padStart(2, "0")}
              </span>
              <ChevronRight size={12} aria-hidden className={cn(showArchived ? "rotate-90" : "")} />
            </button>

            {showArchived ? (
              <ul className="border-border-subtle divide-border-subtle divide-y border-t">
                {archived.map((project) => (
                  <CompactProjectRow
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
          </section>
        ) : null}
      </div>

      <div className="border-border-subtle bg-surface-sidebar shrink-0 border-t px-3 py-2.5">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className="text-fg-primary hover:bg-surface-sunken flex w-full cursor-default items-center gap-3 rounded-sm px-3 py-2 text-left"
            >
              {/*
                Initials, not a photograph. There is no account to carry an
                avatar and nowhere to upload one to; a coloured disc with two
                letters is honest about being generated from the name.
              */}
              <span
                aria-hidden
                className="border-border-default bg-surface-sunken text-fg-primary flex size-7 shrink-0 items-center justify-center rounded-full border text-2xs font-semibold"
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
          aria-label="Workspace settings"
          onClick={onOpenSettings}
          className="text-fg-secondary hover:bg-surface-sunken hover:text-fg-primary flex w-full cursor-default items-center gap-3 rounded-sm px-3 py-2 text-left text-sm"
        >
          <span aria-hidden className="flex size-7 shrink-0 items-center justify-center">
            <Settings size={15} />
          </span>
          Settings
        </button>
      </div>
    </nav>
  );
}

type ProjectDestination = "board" | "notes" | null;

interface ProjectBranchProps {
  project: Project;
  expanded: boolean;
  activeDestination: ProjectDestination;
  onToggle: () => void;
  onOpenBoard: () => void;
  onOpenNotes: () => void;
  onEdit: (project: Project) => void;
  onArchive: (project: Project, archived: boolean) => void;
  onDelete: (project: Project) => void;
}

function ProjectBranch({
  project,
  expanded,
  activeDestination,
  onToggle,
  onOpenBoard,
  onOpenNotes,
  onEdit,
  onArchive,
  onDelete,
}: ProjectBranchProps) {
  const controlsId = `project-nav-${project.id}`;
  const contextual = activeDestination !== null || expanded;

  return (
    <li className="group/branch">
      <div className="relative">
        <button
          type="button"
          aria-label={project.name}
          aria-expanded={expanded}
          aria-controls={controlsId}
          onClick={onToggle}
          className={cn(
            "focus-visible:outline-focus-ring relative grid h-11 w-full cursor-default grid-cols-[1.75rem_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-lg border pr-8 pl-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2",
            contextual
              ? "border-border-subtle bg-surface-column text-fg-primary"
              : "border-transparent text-fg-secondary hover:bg-surface-column hover:text-fg-primary",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "absolute inset-y-1 left-0 w-0.5 rounded-r-full",
              activeDestination === null ? "bg-transparent" : "bg-accent-solid",
            )}
          />
          <span
            aria-hidden
            className="flex size-7 items-center justify-center rounded-md border text-xs font-semibold"
            style={{
              borderColor: colorVariable(project.color),
              backgroundColor: labelColorVariable(project.color),
              color: colorVariable(project.color),
            }}
          >
            {projectInitial(project.name)}
          </span>
          <span className={cn("min-w-0 truncate text-sm", contextual ? "font-medium" : "")}>
            {project.name}
          </span>
          <span className="text-fg-secondary flex min-w-0 items-center gap-1.5">
            {project.directoryMissing ? (
              <FolderX
                size={12}
                aria-label="Project directory is missing"
                className="text-warning-fg shrink-0"
              />
            ) : null}
            <span data-numeric className="truncate font-mono text-[9px] tracking-[0.08em]">
              {project.keyPrefix}
            </span>
          </span>
          <ChevronRight
            size={13}
            aria-hidden
            className={cn(
              "text-fg-secondary transition-transform duration-(--duration-base)",
              expanded ? "rotate-90" : "",
            )}
          />
        </button>

        <ProjectActions
          project={project}
          onEdit={onEdit}
          onArchive={onArchive}
          onDelete={onDelete}
          className="absolute top-1/2 right-1 -translate-y-1/2 opacity-0 group-hover/branch:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
        />
      </div>

      <ul
        id={controlsId}
        aria-label={`${project.name} project navigation`}
        hidden={!expanded}
        className="border-border-subtle ml-6 space-y-0.5 border-l py-1 pl-3"
      >
        <ProjectDestinationLink
          icon={Columns3}
          label="Board View"
          accessibleLabel={`Board view for ${project.name}`}
          selected={activeDestination === "board"}
          onSelect={onOpenBoard}
        />
        <ProjectDestinationLink
          icon={FileText}
          label="Project Notes"
          accessibleLabel={`Project notes for ${project.name}`}
          selected={activeDestination === "notes"}
          onSelect={onOpenNotes}
        />
        <ProjectDestinationLink
          icon={Settings2}
          label="Settings"
          accessibleLabel={`Project settings for ${project.name}`}
          selected={false}
          onSelect={() => {
            onEdit(project);
          }}
        />
      </ul>
    </li>
  );
}

function ProjectDestinationLink({
  icon: Icon,
  label,
  accessibleLabel,
  selected,
  onSelect,
}: {
  icon: LucideIcon;
  label: string;
  accessibleLabel: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li className="relative before:absolute before:top-1/2 before:-left-3 before:h-px before:w-3 before:bg-border-subtle">
      <button
        type="button"
        aria-label={accessibleLabel}
        aria-current={selected ? "page" : undefined}
        onClick={onSelect}
        className={cn(
          "focus-visible:outline-focus-ring flex h-9 w-full cursor-default items-center gap-2.5 rounded-md px-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-offset-2",
          selected
            ? "bg-surface-card text-fg-primary font-medium"
            : "text-fg-secondary hover:bg-surface-column hover:text-fg-primary",
        )}
      >
        <Icon
          size={15}
          strokeWidth={1.75}
          aria-hidden
          className={selected ? "text-accent-fg" : "text-fg-secondary"}
        />
        <span className="truncate">{label}</span>
      </button>
    </li>
  );
}

function projectInitial(name: string): string {
  return Array.from(name.trim())[0]?.toLocaleUpperCase() ?? "·";
}

function ProjectActions({
  project,
  onEdit,
  onArchive,
  onDelete,
  className,
}: {
  project: Project;
  onEdit: (project: Project) => void;
  onArchive: (project: Project, archived: boolean) => void;
  onDelete: (project: Project) => void;
  className?: string;
}) {
  const isArchived = project.archivedAt !== null;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <IconButton label={`Actions for ${project.name}`} className={className}>
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

interface CompactProjectRowProps {
  project: Project;
  managed?: boolean;
  selected: boolean;
  onSelect: (project: Project) => void;
  onEdit: (project: Project) => void;
  onArchive: (project: Project, archived: boolean) => void;
  onDelete: (project: Project) => void;
  asListItem?: boolean;
}

function CompactProjectRow({
  project,
  managed = false,
  selected,
  onSelect,
  onEdit,
  onArchive,
  onDelete,
  asListItem = true,
}: CompactProjectRowProps) {
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
          "grid w-full cursor-default grid-cols-[0.75rem_minmax(0,1fr)_auto] items-center gap-2 border-l-2 py-2.5 pr-9 pl-2 text-left",
          selected
            ? "border-accent-solid bg-surface-sunken/55 text-fg-primary"
            : "border-transparent text-fg-secondary hover:bg-surface-sunken hover:text-fg-primary",
          isArchived ? "opacity-70" : "",
        )}
      >
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: colorVariable(project.color) }}
        />
        <span className={cn("min-w-0 truncate text-sm", selected ? "font-medium" : "")}>
          {project.name}
        </span>
        <span className="text-fg-secondary flex min-w-0 items-center gap-1.5">
          {project.directoryMissing ? (
            <FolderX
              size={12}
              aria-label="Project directory is missing"
              className="text-warning-fg shrink-0"
            />
          ) : null}
          <span data-numeric className="truncate font-mono text-[9px] tracking-[0.06em]">
            {managed ? "AI/" : ""}
            {project.keyPrefix}
          </span>
        </span>
      </button>

      <ProjectActions
        project={project}
        onEdit={onEdit}
        onArchive={onArchive}
        onDelete={onDelete}
        className="absolute top-1/2 right-1 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
      />
    </Root>
  );
}
