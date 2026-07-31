import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Archive,
  ArchiveRestore,
  ChevronsUpDown,
  FileText,
  FolderX,
  LayoutDashboard,
  LayoutGrid,
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
import type { Project } from "@/lib/bindings/Project";
import { ProjectDot } from "./ProjectColor";

/** The workspace-level destinations, as distinct from an individual project. */
export type WorkspaceView = "dashboard" | "projects" | "notes" | "board";

interface ProjectSidebarProps {
  active: Project[];
  archived: Project[];
  selectedId: string | null;
  view: WorkspaceView;
  onNavigate: (view: WorkspaceView) => void;
  profileName: string;
  onRenameProfile: () => void;
  onSelect: (project: Project) => void;
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
  selectedId,
  view,
  onNavigate,
  profileName,
  onRenameProfile,
  onSelect,
  onCreate,
  onEdit,
  onArchive,
  onDelete,
  onOpenSettings,
}: ProjectSidebarProps) {
  const [showArchived, setShowArchived] = useState(false);

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
            selected={view === "projects" || view === "board"}
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

        <div className="mt-5 mb-1.5 flex items-center justify-between gap-2">
          <SectionLabel>Projects</SectionLabel>
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

        {archived.length > 0 ? (
          <div className="mt-5">
            <button
              type="button"
              onClick={() => {
                setShowArchived((value) => !value);
              }}
              aria-expanded={showArchived}
              className="text-fg-secondary hover:text-fg-primary flex w-full cursor-default items-center justify-between rounded-md px-2 py-1 text-2xs font-semibold tracking-[0.08em] uppercase"
            >
              <span>Archived</span>
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
  selected: boolean;
  onSelect: (project: Project) => void;
  onEdit: (project: Project) => void;
  onArchive: (project: Project, archived: boolean) => void;
  onDelete: (project: Project) => void;
}

function ProjectRow({ project, selected, onSelect, onEdit, onArchive, onDelete }: ProjectRowProps) {
  const isArchived = project.archivedAt !== null;

  return (
    <li className="group relative">
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={() => {
          onSelect(project);
        }}
        className={cn(
          "flex w-full cursor-default items-center gap-2.5 rounded-md py-2 pr-8 pl-2 text-left text-sm",
          selected
            ? "bg-accent-bg text-accent-fg font-medium"
            : "text-fg-secondary hover:bg-surface-sunken hover:text-fg-primary",
          isArchived ? "opacity-70" : "",
        )}
      >
        <ProjectDot color={project.color} />
        <span className="truncate">{project.name}</span>
        {project.directoryMissing ? (
          <FolderX
            size={12}
            aria-label="Project directory is missing"
            className="text-warning-fg ml-auto shrink-0"
          />
        ) : null}
      </button>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <IconButton
            label={`Actions for ${project.name}`}
            className="absolute top-1/2 right-0.5 -translate-y-1/2 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
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
    </li>
  );
}
