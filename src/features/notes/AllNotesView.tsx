import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { FileText, Files, Link2, Plus, Search } from "lucide-react";
import { useState } from "react";

import { notifyError } from "@/app/toast";
import { BlurFade } from "@/components/magicui/BlurFade";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { MenuContent, MenuItem } from "@/components/ui/Menu";
import { useBoards } from "@/features/boards/queries";
import { ProjectDot } from "@/features/projects/ProjectColor";
import type { Note } from "@/lib/bindings/Note";
import type { NoteIndexItem } from "@/lib/bindings/NoteIndexItem";
import type { Project } from "@/lib/bindings/Project";
import { cn } from "@/lib/cn";
import { messageFor } from "@/lib/errors";

import { EmptyDocument, NoteEditor } from "./NotesView";
import { useAllNotes, useCreateProjectNote, useDeleteNote, useNotes } from "./queries";
import { type TaskTarget, useNoteTaskContexts } from "./taskContexts";

interface AllNotesViewProps {
  projects: Project[];
  onOpenTask: (task: TaskTarget) => void;
}

interface NoteSelection {
  id: string;
  projectId: string;
}

interface NoteGroup {
  project: Project | null;
  projectId: string;
  notes: NoteIndexItem[];
}

/**
 * A workspace-wide note index with one canonical, project-owned editor.
 *
 * The index response is deliberately lightweight. Selecting a row opens the
 * existing project-scoped note and board queries, so All Notes never becomes a
 * second source of note data and never has to change the saved board workspace.
 */
export function AllNotesView({ projects, onOpenTask }: AllNotesViewProps) {
  const noteIndex = useAllNotes();
  const [selection, setSelection] = useState<NoteSelection | null>(null);
  const [filter, setFilter] = useState("");
  const [deleting, setDeleting] = useState<Note | null>(null);

  const activeProjects = projects.filter((project) => project.archivedAt === null);
  const projectsById = new Map(activeProjects.map((project) => [project.id, project]));
  const allNotes = noteIndex.data ?? [];
  const selectedSummary =
    (selection === null ? null : allNotes.find((note) => note.id === selection.id)) ??
    allNotes[0] ??
    null;
  const selectedProject =
    selectedSummary === null ? null : (projectsById.get(selectedSummary.projectId) ?? null);

  const projectNotes = useNotes(selectedSummary?.projectId ?? null);
  const boards = useBoards(selectedSummary?.projectId ?? null);
  const taskContexts = useNoteTaskContexts(
    selectedSummary?.projectId ?? null,
    selectedProject?.keyPrefix ?? null,
    boards.data ?? [],
  );
  const selectedNote = projectNotes.data?.find((note) => note.id === selectedSummary?.id) ?? null;

  const createNote = useCreateProjectNote();
  const deleteNote = useDeleteNote(deleting?.projectId ?? selectedSummary?.projectId ?? "");
  const normalizedFilter = filter.trim().toLocaleLowerCase();
  const visibleNotes =
    normalizedFilter === ""
      ? allNotes
      : allNotes.filter((note) => {
          const projectName = projectsById.get(note.projectId)?.name ?? "";
          return `${projectName}\n${note.title}\n${note.excerpt}`
            .toLocaleLowerCase()
            .includes(normalizedFilter);
        });
  const groups = groupByProject(visibleNotes, projectsById);

  function createInProject(project: Project) {
    createNote.mutate(
      { projectId: project.id, title: "Untitled note" },
      {
        onSuccess: (note) => {
          setFilter("");
          setSelection({ id: note.id, projectId: note.projectId });
        },
        onError: (error) => {
          notifyError(messageFor(error));
        },
      },
    );
  }

  return (
    <BlurFade className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[19rem_minmax(0,1fr)] lg:grid-rows-1">
        <aside className="border-border-default bg-surface-column flex max-h-72 min-h-0 flex-col border-b lg:max-h-none lg:border-r lg:border-b-0">
          <div className="border-border-subtle flex h-11 shrink-0 items-center gap-2 border-b px-3">
            <Files size={14} aria-hidden className="text-fg-secondary" />
            <h1 className="text-fg-primary min-w-0 flex-1 truncate text-sm font-semibold">
              All notes
            </h1>
            <span className="text-fg-secondary font-mono text-[9px]">
              {String(allNotes.length)}
            </span>
            <NewNoteMenu
              projects={activeProjects}
              creating={createNote.isPending}
              onCreate={createInProject}
            />
          </div>

          <div className="border-border-subtle border-b px-3 py-2">
            <label className="bg-surface-app focus-within:outline-focus-ring flex h-8 items-center gap-2 rounded-md px-2.5 focus-within:outline-2 focus-within:-outline-offset-2">
              <Search size={13} aria-hidden className="text-fg-secondary shrink-0" />
              <span className="sr-only">Search all notes</span>
              <input
                type="search"
                value={filter}
                onChange={(event) => {
                  setFilter(event.target.value);
                }}
                placeholder="Search notes and projects"
                className="text-fg-primary placeholder:text-fg-secondary min-w-0 flex-1 bg-transparent text-xs outline-none"
              />
            </label>
          </div>

          {noteIndex.isPending ? (
            <p role="status" className="text-fg-secondary px-4 py-5 text-xs">
              Gathering notes…
            </p>
          ) : noteIndex.isError ? (
            <p role="alert" className="text-danger-fg px-4 py-5 text-xs">
              {messageFor(noteIndex.error)}
            </p>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
              {groups.map((group) => (
                <NoteProjectGroup
                  key={group.projectId}
                  group={group}
                  selectedId={selectedSummary?.id ?? null}
                  onSelect={(note) => {
                    setSelection({ id: note.id, projectId: note.projectId });
                  }}
                />
              ))}

              {groups.length === 0 ? (
                <p className="text-fg-secondary px-2 py-4 text-xs">
                  {allNotes.length === 0
                    ? "No notes in active projects yet."
                    : "No notes match this search."}
                </p>
              ) : null}
            </div>
          )}
        </aside>

        {selectedSummary === null ? (
          <EmptyDocument
            title="Your project notes, together"
            body="Create a note in a project to keep plans and decisions beside the work they belong to."
            action={
              activeProjects.length === 0 ? null : (
                <NewNoteMenu
                  projects={activeProjects}
                  creating={createNote.isPending}
                  onCreate={createInProject}
                  prominent
                />
              )
            }
          />
        ) : projectNotes.isPending || boards.isPending ? (
          <p role="status" className="text-fg-secondary px-7 py-6 text-sm">
            Opening {selectedProject?.name ?? "project"}…
          </p>
        ) : projectNotes.isError || boards.isError ? (
          <EmptyDocument
            title="This note could not be opened"
            body={messageFor(projectNotes.error ?? boards.error)}
          />
        ) : selectedNote === null ? (
          <EmptyDocument
            title="This note is no longer available"
            body="It may have been removed from its project. Choose another note from the index."
          />
        ) : (
          <NoteEditor
            key={selectedNote.id}
            note={selectedNote}
            projectId={selectedNote.projectId}
            projectName={selectedProject?.name ?? "Project"}
            taskContexts={taskContexts}
            onOpenTask={onOpenTask}
            onDelete={() => {
              setDeleting(selectedNote);
            }}
          />
        )}
      </div>

      {deleting !== null ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleting(null);
          }}
          title="Delete this note?"
          confirmLabel="Delete note"
          confirmDisabled={deleteNote.isPending}
          onConfirm={() => {
            deleteNote.mutate(deleting.id, {
              onSuccess: () => {
                setSelection(null);
                setDeleting(null);
              },
              onError: (error) => {
                notifyError(messageFor(error));
              },
            });
          }}
        >
          <p className="text-fg-secondary text-sm">
            “{deleting.title}” will be removed from its project. This cannot be undone.
          </p>
        </ConfirmDialog>
      ) : null}
    </BlurFade>
  );
}

function NewNoteMenu({
  projects,
  creating,
  onCreate,
  prominent = false,
}: {
  projects: Project[];
  creating: boolean;
  onCreate: (project: Project) => void;
  prominent?: boolean;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        {prominent ? (
          <Button
            variant="primary"
            size="sm"
            aria-label="Create a note"
            disabled={creating || projects.length === 0}
          >
            <Plus size={13} aria-hidden />
            New note
          </Button>
        ) : (
          <button
            type="button"
            aria-label="New note"
            title={projects.length === 0 ? "Create a project first" : "New note"}
            disabled={creating || projects.length === 0}
            className="text-fg-secondary hover:bg-surface-sunken hover:text-fg-primary focus-visible:outline-focus-ring inline-flex size-7 shrink-0 cursor-default items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50"
          >
            <Plus size={14} aria-hidden />
          </button>
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <MenuContent align="end" className="w-60">
          <DropdownMenu.Label className="border-border-subtle text-fg-secondary border-b px-2 py-1.5 font-mono text-[9px] tracking-[0.12em] uppercase">
            Choose a project
          </DropdownMenu.Label>
          {projects.map((project) => (
            <MenuItem
              key={project.id}
              onSelect={() => {
                onCreate(project);
              }}
            >
              <ProjectDot color={project.color} className="size-1.5" />
              <span className="min-w-0 flex-1 truncate">{project.name}</span>
              <span className="text-fg-secondary font-mono text-[9px]">{project.keyPrefix}</span>
            </MenuItem>
          ))}
        </MenuContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function NoteProjectGroup({
  group,
  selectedId,
  onSelect,
}: {
  group: NoteGroup;
  selectedId: string | null;
  onSelect: (note: NoteIndexItem) => void;
}) {
  const projectName = group.project?.name ?? "Unknown project";

  return (
    <section aria-label={`${projectName} notes`} className="mb-4 last:mb-0">
      <div className="flex h-7 items-center gap-2 px-2">
        {group.project === null ? (
          <span aria-hidden className="bg-fg-secondary size-1.5 rounded-full" />
        ) : (
          <ProjectDot color={group.project.color} className="size-1.5" />
        )}
        <h2 className="text-fg-secondary min-w-0 flex-1 truncate text-[11px] font-semibold">
          {projectName}
        </h2>
        {group.project === null ? null : (
          <span className="text-fg-secondary font-mono text-[9px]">{group.project.keyPrefix}</span>
        )}
      </div>

      <ol aria-label={`Notes in ${projectName}`} className="space-y-0.5">
        {group.notes.map((note) => {
          const selected = note.id === selectedId;
          const excerpt = readableExcerpt(note.excerpt);
          return (
            <li key={note.id}>
              <button
                type="button"
                aria-current={selected ? "page" : undefined}
                aria-label={`${note.title}, ${projectName}`}
                onClick={() => {
                  onSelect(note);
                }}
                className={cn(
                  "group relative flex w-full cursor-default items-start gap-2 rounded-lg px-2 py-2 text-left",
                  selected
                    ? "bg-surface-card text-fg-primary"
                    : "hover:bg-surface-sunken text-fg-secondary",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-2 bottom-2 left-0 w-0.5 rounded-full",
                    selected ? "bg-accent-solid" : "bg-transparent",
                  )}
                />
                <FileText
                  size={13}
                  aria-hidden
                  className={cn(
                    "mt-0.5 shrink-0",
                    selected ? "text-accent-fg" : "text-fg-secondary",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="text-fg-primary block truncate text-xs font-medium">
                    {note.title}
                  </span>
                  <span className="text-fg-secondary mt-0.5 block truncate text-[10px]">
                    {excerpt}
                  </span>
                </span>
                {note.taskCount === 0 ? null : (
                  <span className="text-fg-secondary mt-0.5 inline-flex shrink-0 items-center gap-0.5 font-mono text-[9px]">
                    <Link2 size={9} aria-hidden /> {String(note.taskCount)}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function groupByProject(notes: NoteIndexItem[], projects: Map<string, Project>): NoteGroup[] {
  const groups = new Map<string, NoteGroup>();
  for (const note of notes) {
    const existing = groups.get(note.projectId);
    if (existing === undefined) {
      groups.set(note.projectId, {
        project: projects.get(note.projectId) ?? null,
        projectId: note.projectId,
        notes: [note],
      });
    } else {
      existing.notes.push(note);
    }
  }
  return [...groups.values()];
}

function readableExcerpt(markdown: string): string {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, " code ")
    .replace(/[#>*_`~[\]()!-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain === "" ? "Empty note" : plain;
}
