import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Archive,
  ArchiveRestore,
  FolderX,
  MoreHorizontal,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import { Button, IconButton } from "@/components/ui/Button";
import { MenuContent, MenuItem, MenuSeparator } from "@/components/ui/Menu";
import { cn } from "@/lib/cn";
import type { Project } from "@/lib/bindings/Project";
import { ProjectDot } from "./ProjectColor";

interface ProjectSidebarProps {
  active: Project[];
  archived: Project[];
  selectedId: string | null;
  onSelect: (project: Project) => void;
  onCreate: () => void;
  onEdit: (project: Project) => void;
  onArchive: (project: Project, archived: boolean) => void;
  onDelete: (project: Project) => void;
}

export function ProjectSidebar({
  active,
  archived,
  selectedId,
  onSelect,
  onCreate,
  onEdit,
  onArchive,
  onDelete,
}: ProjectSidebarProps) {
  const [showArchived, setShowArchived] = useState(false);

  return (
    <nav
      aria-label="Projects"
      className="border-border-subtle bg-surface-column flex w-60 shrink-0 flex-col border-r"
    >
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 px-3">
        <h2 className="text-fg-secondary text-xs font-semibold tracking-[0.06em] uppercase">
          Projects
        </h2>
        <IconButton label="New project" onClick={onCreate}>
          <Plus size={14} aria-hidden />
        </IconButton>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {active.length === 0 ? (
          <EmptyState onCreate={onCreate} />
        ) : (
          <ul className="space-y-px">
            {active.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                selected={project.id === selectedId}
                onSelect={onSelect}
                onEdit={onEdit}
                onArchive={onArchive}
                onDelete={onDelete}
              />
            ))}
          </ul>
        )}

        {archived.length > 0 ? (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => {
                setShowArchived((value) => !value);
              }}
              aria-expanded={showArchived}
              className="text-fg-tertiary hover:text-fg-secondary flex w-full cursor-default items-center justify-between rounded-md px-2 py-1 text-2xs font-semibold tracking-[0.06em] uppercase"
            >
              <span>Archived</span>
              <span data-numeric>{archived.length}</span>
            </button>

            {showArchived ? (
              <ul className="mt-px space-y-px">
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
    </nav>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="px-2 py-6">
      <p className="text-fg-primary text-xs font-medium">No projects yet</p>
      <p className="text-fg-tertiary mt-1 text-2xs">
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
          "flex w-full cursor-default items-center gap-2 rounded-md py-1.5 pr-7 pl-2 text-left text-xs",
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
