import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import {
  Check,
  CircleAlert,
  CircleDashed,
  Eye,
  FileText,
  Link2,
  LoaderCircle,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Unlink,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { notifyError } from "@/app/toast";
import { BlurFade } from "@/components/magicui/BlurFade";
import { IconButton } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { MenuCheckboxItem, MenuContent } from "@/components/ui/Menu";
import { IDLE_PREVIEW_DELAY_MS, useIdlePreview } from "@/components/ui/useIdlePreview";
import { Markdown } from "@/features/board/Markdown";
import type { Board } from "@/lib/bindings/Board";
import type { Note } from "@/lib/bindings/Note";
import type { NotePatch } from "@/lib/bindings/NotePatch";
import { cn } from "@/lib/cn";
import { messageFor } from "@/lib/errors";
import { queryKeys } from "@/lib/query/keys";
import { LIMITS } from "@/lib/schemas";

import { useCreateNote, useDeleteNote, useNotes, useUpdateNote } from "./queries";
import { type TaskContext, type TaskTarget, useNoteTaskContexts } from "./taskContexts";

/** A pause is enough to save without turning every keystroke into a write. */
const SAVE_DELAY_MS = 500;

interface NotesViewProps {
  projectId: string | null;
  projectName: string | null;
  projectKeyPrefix: string | null;
  boards: Board[];
  onOpenTask: (task: TaskTarget) => void;
}

/**
 * The project's document workspace.
 *
 * The structure follows the durable patterns shared by Notion and Obsidian: a
 * quiet page explorer, one focused document canvas, and compact linked work in
 * the page properties. Notes stay plain Markdown in storage; the interface
 * does not add a second document model on top of them.
 */
export function NotesView({
  projectId,
  projectName,
  projectKeyPrefix,
  boards,
  onOpenTask,
}: NotesViewProps) {
  const notes = useNotes(projectId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Note | null>(null);
  const [filter, setFilter] = useState("");

  const taskContexts = useNoteTaskContexts(projectId, projectKeyPrefix, boards);

  const createNote = useCreateNote(projectId ?? "");
  const deleteNote = useDeleteNote(projectId ?? "");
  const list = notes.data ?? [];
  const selected = list.find((note) => note.id === selectedId) ?? list[0] ?? null;
  const query = filter.trim().toLocaleLowerCase();
  const visibleNotes =
    query === ""
      ? list
      : list.filter((note) => `${note.title}\n${note.body}`.toLocaleLowerCase().includes(query));

  function createBlankNote() {
    createNote.mutate("Untitled note", {
      onSuccess: (note) => {
        setFilter("");
        setSelectedId(note.id);
      },
      onError: (error) => {
        notifyError(messageFor(error));
      },
    });
  }

  if (projectId === null) {
    return (
      <BlurFade className="flex h-full flex-col">
        <EmptyDocument
          title="Choose a project to open its notes"
          body="Plans, decisions, and working context stay alongside the project they describe."
        />
      </BlurFade>
    );
  }

  return (
    <BlurFade className="flex h-full min-h-0 flex-col overflow-hidden">
      {notes.isPending ? (
        <p role="status" className="text-fg-secondary px-6 py-5 text-sm">
          Opening notes…
        </p>
      ) : (
        <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[15rem_minmax(0,1fr)] lg:grid-rows-1">
          <NotesExplorer
            projectName={projectName ?? "Project"}
            notes={visibleNotes}
            total={list.length}
            selectedId={selected?.id ?? null}
            filter={filter}
            creating={createNote.isPending}
            onFilterChange={setFilter}
            onSelect={setSelectedId}
            onCreate={createBlankNote}
          />

          {notes.isError ? (
            <EmptyDocument title="Notes could not be opened" body={messageFor(notes.error)} />
          ) : selected === null ? (
            <EmptyDocument
              title="Create the first page"
              body="Use it for a plan, a decision, research, or any context that needs to outlive one task."
            />
          ) : (
            <NoteEditor
              key={selected.id}
              note={selected}
              projectId={projectId}
              projectName={projectName ?? "Project"}
              taskContexts={taskContexts}
              onOpenTask={onOpenTask}
              onDelete={() => {
                setDeleting(selected);
              }}
            />
          )}
        </div>
      )}

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
                setSelectedId(null);
                setDeleting(null);
              },
              onError: (error) => {
                notifyError(messageFor(error));
              },
            });
          }}
        >
          <p className="text-fg-secondary text-sm">
            “{deleting.title}” will be removed from this project. This cannot be undone.
          </p>
        </ConfirmDialog>
      ) : null}
    </BlurFade>
  );
}

function NotesExplorer({
  projectName,
  notes,
  total,
  selectedId,
  filter,
  creating,
  onFilterChange,
  onSelect,
  onCreate,
}: {
  projectName: string;
  notes: Note[];
  total: number;
  selectedId: string | null;
  filter: string;
  creating: boolean;
  onFilterChange: (value: string) => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  return (
    <aside className="border-border-default bg-surface-column flex max-h-56 min-h-0 flex-col border-b lg:max-h-none lg:border-r lg:border-b-0">
      <div className="border-border-subtle flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <FileText size={14} aria-hidden className="text-fg-secondary" />
        <h2 className="text-fg-primary min-w-0 flex-1 truncate text-sm font-semibold">Pages</h2>
        <span className="text-fg-secondary font-mono text-[9px]">{String(total)}</span>
        <IconButton label="New note" onClick={onCreate} disabled={creating} className="size-6">
          <Plus size={13} aria-hidden />
        </IconButton>
      </div>

      <div className="px-2 pt-2 pb-1">
        <label className="focus-within:bg-surface-sunken flex h-7 items-center gap-2 rounded-md px-2">
          <Search size={13} aria-hidden className="text-fg-secondary shrink-0" />
          <span className="sr-only">Filter notes</span>
          <input
            type="search"
            value={filter}
            onChange={(event) => {
              onFilterChange(event.target.value);
            }}
            placeholder="Search notes"
            className="text-fg-primary placeholder:text-fg-secondary focus-visible:outline-focus-ring min-w-0 flex-1 bg-transparent text-xs focus-visible:outline-2 focus-visible:outline-offset-2"
          />
        </label>
      </div>

      <p className="text-fg-secondary truncate px-4 pt-2 pb-1 text-[11px] font-medium">
        {projectName}
      </p>

      <ol
        aria-label="Notes"
        className="min-h-0 space-y-0.5 overflow-x-auto overflow-y-auto px-2 pb-3 lg:overflow-x-hidden"
      >
        {notes.map((note) => {
          const active = note.id === selectedId;
          return (
            <li key={note.id}>
              <button
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  onSelect(note.id);
                }}
                className={cn(
                  "group flex h-8 w-full cursor-default items-center gap-2 rounded-md px-2 text-left",
                  active ? "bg-surface-sunken text-fg-primary" : "hover:bg-surface-sunken",
                )}
              >
                <FileText
                  size={13}
                  aria-hidden
                  className={cn("shrink-0", active ? "text-fg-primary" : "text-fg-secondary")}
                />
                <span className="text-fg-primary min-w-0 flex-1 truncate text-xs">
                  {note.title}
                </span>
                {note.taskIds.length === 0 ? null : (
                  <span className="text-fg-secondary inline-flex shrink-0 items-center gap-0.5 font-mono text-[9px]">
                    <Link2 size={9} aria-hidden /> {String(note.taskIds.length)}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>

      {notes.length === 0 ? (
        <p className="text-fg-secondary px-4 py-3 text-xs">
          {total === 0 ? "No notes yet." : "No matching notes."}
        </p>
      ) : null}
    </aside>
  );
}

type SaveState = "saved" | "dirty" | "saving" | "error";

interface Draft {
  title: string;
  body: string;
  taskIds: string[];
}

interface SavedDraft extends Draft {
  updatedAt: number;
}

export function NoteEditor({
  note,
  projectId,
  projectName,
  taskContexts,
  onOpenTask,
  onDelete,
}: {
  note: Note;
  projectId: string;
  projectName: string;
  taskContexts: TaskContext[];
  onOpenTask: (task: TaskTarget) => void;
  onDelete: () => void;
}) {
  const update = useUpdateNote();
  const client = useQueryClient();
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [taskIds, setTaskIds] = useState(note.taskIds);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyField = useRef<HTMLTextAreaElement>(null);
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const queued = useRef(false);
  const observedUpdatedAt = useRef(note.updatedAt);
  const saved = useRef<SavedDraft>({
    title: note.title,
    body: note.body,
    taskIds: note.taskIds,
    updatedAt: note.updatedAt,
  });
  const latest = useRef<Draft>({ title: note.title, body: note.body, taskIds: note.taskIds });
  const commitRef = useRef<() => Promise<void>>(() => Promise.resolve());
  const { previewing, beginEditing, showPreview, previewAfterPause } = useIdlePreview(
    IDLE_PREVIEW_DELAY_MS,
    note.body.trim() !== "",
  );

  useEffect(() => {
    commitRef.current = async () => {
      if (inFlight.current) {
        queued.current = true;
        return;
      }

      const next = latest.current;
      const baseline = saved.current;
      if (!draftHasChanges(next, baseline)) {
        if (mounted.current) setSaveState("saved");
        return;
      }

      const patch: NotePatch = {
        title: next.title !== baseline.title ? next.title : null,
        body: next.body !== baseline.body ? next.body : null,
        taskIds: !sameIds(next.taskIds, baseline.taskIds) ? next.taskIds : null,
      };

      inFlight.current = true;
      queued.current = false;
      if (mounted.current) {
        setSaveError(null);
        setSaveState("saving");
      }

      try {
        const updated = await update.mutateAsync({
          id: note.id,
          expectedUpdatedAt: baseline.updatedAt,
          patch,
        });
        saved.current = {
          title: updated.title,
          body: updated.body,
          taskIds: updated.taskIds,
          updatedAt: updated.updatedAt,
        };
        observedUpdatedAt.current = updated.updatedAt;
        client.setQueryData<Note[]>(queryKeys.notes(projectId), (current) =>
          current?.map((candidate) => (candidate.id === updated.id ? updated : candidate)),
        );

        if (draftHasChanges(latest.current, saved.current)) queued.current = true;
        if (mounted.current) setSaveState(queued.current ? "dirty" : "saved");
      } catch (error) {
        queued.current = false;
        if (mounted.current) {
          setSaveError(messageFor(error));
          setSaveState("error");
        }
        notifyError(`The note was not saved. ${messageFor(error)}`);
      } finally {
        inFlight.current = false;
        if (queued.current) {
          queued.current = false;
          void commitRef.current();
        }
      }
    };
  }, [client, note.id, projectId, update]);

  function schedule(next: Draft, delay = SAVE_DELAY_MS) {
    latest.current = next;
    setSaveError(null);
    setSaveState("dirty");
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void commitRef.current();
    }, delay);
  }

  // A write from MCP is accepted into an untouched editor. If local work is
  // already underway, it stays on screen and CAS turns the next write into an
  // explicit conflict instead of silently overwriting either author.
  useEffect(() => {
    if (note.updatedAt === observedUpdatedAt.current) return;
    observedUpdatedAt.current = note.updatedAt;

    if (!draftHasChanges(latest.current, saved.current) && !inFlight.current) {
      const incoming = { title: note.title, body: note.body, taskIds: note.taskIds };
      setTitle(incoming.title);
      setBody(incoming.body);
      setTaskIds(incoming.taskIds);
      latest.current = incoming;
      saved.current = { ...incoming, updatedAt: note.updatedAt };
      setSaveError(null);
      setSaveState("saved");
    }
  }, [note.body, note.taskIds, note.title, note.updatedAt]);

  useEffect(
    () => () => {
      mounted.current = false;
      if (timer.current !== null) clearTimeout(timer.current);
      if (draftHasChanges(latest.current, saved.current)) void commitRef.current();
    },
    [],
  );

  function editBody() {
    beginEditing();
    requestAnimationFrame(() => {
      bodyField.current?.focus();
    });
  }

  function replaceTaskIds(nextIds: string[]) {
    setTaskIds(nextIds);
    schedule({ title, body, taskIds: nextIds }, 0);
  }

  function applyStarter(markdown: string) {
    setBody(markdown);
    schedule({ title, body: markdown, taskIds });
    previewAfterPause(true);
    requestAnimationFrame(() => bodyField.current?.focus());
  }

  return (
    <section aria-label={`Note: ${note.title}`} className="flex min-h-0 min-w-0 flex-col">
      <div className="border-border-default flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <FileText size={13} aria-hidden className="text-fg-secondary shrink-0" />
        <span className="text-fg-primary min-w-0 flex-1 truncate text-xs">{title}</span>
        <SaveIndicator state={saveState} />

        <div className="ml-2 flex items-center" aria-label="Note mode">
          <ModeButton active={!previewing} onClick={editBody}>
            <Pencil size={12} aria-hidden />
            Edit
          </ModeButton>
          <ModeButton active={previewing} onClick={showPreview}>
            <Eye size={12} aria-hidden />
            Reading
          </ModeButton>
        </div>

        <IconButton label={`Delete ${note.title}`} onClick={onDelete}>
          <Trash2 size={14} aria-hidden />
        </IconButton>
      </div>

      {saveState === "error" ? (
        <div className="border-danger-border bg-danger-bg text-danger-fg flex shrink-0 items-center gap-2 border-b px-5 py-2 text-xs lg:px-7">
          <CircleAlert size={13} aria-hidden className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {saveError ?? "This page has not been saved."}
          </span>
          <button
            type="button"
            onClick={() => {
              void commitRef.current();
            }}
            className="inline-flex cursor-default items-center gap-1 font-medium underline underline-offset-2"
          >
            <RotateCcw size={11} aria-hidden /> Retry
          </button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        <div className="min-h-0 min-w-0 overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-[920px] flex-col px-7 pt-10 pb-16 sm:px-10 xl:px-14">
            <FileText size={28} strokeWidth={1.4} aria-hidden className="text-fg-secondary mb-4" />
            <label htmlFor="note-title" className="sr-only">
              Note title
            </label>
            <input
              id="note-title"
              type="text"
              value={title}
              maxLength={LIMITS.noteTitle}
              onChange={(event) => {
                const nextTitle = event.target.value;
                setTitle(nextTitle);
                schedule({ title: nextTitle, body, taskIds });
              }}
              onBlur={() => {
                if (title.trim() !== "") return;
                const fallback = "Untitled note";
                setTitle(fallback);
                schedule({ title: fallback, body, taskIds }, 0);
              }}
              placeholder="Untitled"
              className="text-fg-primary placeholder:text-fg-secondary focus-visible:outline-focus-ring w-full bg-transparent text-[30px] leading-tight font-semibold tracking-[-0.035em] focus-visible:outline-2 focus-visible:outline-offset-2"
            />

            <NoteProperties
              projectName={projectName}
              updatedAt={note.updatedAt}
              taskIds={taskIds}
              tasks={taskContexts}
              onChange={replaceTaskIds}
              onOpenTask={onOpenTask}
            />

            <div className="border-border-subtle mt-7 flex min-h-[28rem] flex-1 flex-col border-t pt-6">
              {previewing ? (
                <div data-selectable className="flex-1">
                  {body.trim() === "" ? (
                    <button
                      type="button"
                      onClick={editBody}
                      className="text-fg-secondary hover:text-fg-primary cursor-text text-left text-[15px]"
                    >
                      This page is empty. Click to start writing.
                    </button>
                  ) : (
                    <Markdown className="text-[15px] leading-7">{body}</Markdown>
                  )}
                </div>
              ) : (
                <>
                  <div className="text-fg-secondary mb-3 hidden justify-end sm:flex">
                    <span className="font-mono text-[9px]">{String(body.length)} characters</span>
                  </div>
                  <div className="flex min-h-[24rem] flex-1 flex-col">
                    <label htmlFor="note-body" className="sr-only">
                      Note body
                    </label>
                    <textarea
                      ref={bodyField}
                      id="note-body"
                      value={body}
                      maxLength={LIMITS.noteBody}
                      placeholder="Start writing…"
                      onChange={(event) => {
                        const nextBody = event.target.value;
                        setBody(nextBody);
                        schedule({ title, body: nextBody, taskIds });
                        previewAfterPause(nextBody.trim() !== "");
                      }}
                      className="text-fg-primary placeholder:text-fg-secondary focus-visible:outline-focus-ring min-h-[20rem] flex-1 resize-none bg-transparent text-[15px] leading-7 focus-visible:-outline-offset-2 focus-visible:outline-2"
                    />
                    {body.trim() === "" ? <StarterPages onChoose={applyStarter} /> : null}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "focus-visible:outline-focus-ring inline-flex h-7 cursor-default items-center gap-1.5 rounded-md px-2.5 text-2xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2",
        active
          ? "bg-surface-sunken text-fg-primary"
          : "text-fg-secondary hover:bg-surface-sunken hover:text-fg-primary",
      )}
    >
      {children}
    </button>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === "saving") {
    return (
      <span
        role="status"
        className="text-fg-secondary inline-flex shrink-0 items-center gap-1 text-2xs"
      >
        <LoaderCircle size={10} aria-hidden /> Saving
      </span>
    );
  }
  if (state === "dirty") {
    return (
      <span
        role="status"
        className="text-fg-secondary inline-flex shrink-0 items-center gap-1 text-2xs"
      >
        <CircleDashed size={10} aria-hidden /> Unsaved
      </span>
    );
  }
  if (state === "error") {
    return (
      <span
        role="status"
        className="text-danger-fg inline-flex shrink-0 items-center gap-1 text-2xs"
      >
        <CircleAlert size={10} aria-hidden /> Save failed
      </span>
    );
  }
  return (
    <span
      role="status"
      className="text-fg-secondary inline-flex shrink-0 items-center gap-1 text-2xs"
    >
      <Check size={10} aria-hidden /> Saved
    </span>
  );
}

function NoteProperties({
  projectName,
  updatedAt,
  taskIds,
  tasks,
  onChange,
  onOpenTask,
}: LinkedWorkProps & { projectName: string; updatedAt: number }) {
  const linked = resolveTasks(taskIds, tasks);
  const linkedCount = linked.filter((task) => task !== null).length;

  return (
    <dl className="text-fg-secondary mt-6 max-w-2xl space-y-1 text-xs">
      <div className="flex min-h-7 items-start gap-3">
        <dt className="w-24 shrink-0 py-1">Project</dt>
        <dd className="text-fg-primary min-w-0 py-1">{projectName}</dd>
      </div>
      <div className="flex min-h-7 items-start gap-3">
        <dt className="w-24 shrink-0 py-1">Linked tasks</dt>
        <dd className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
          {linked.map((task, index) =>
            task === null ? (
              <button
                key={taskIds[index]}
                type="button"
                aria-label="Remove unavailable task reference"
                onClick={() => {
                  onChange(taskIds.filter((id) => id !== taskIds[index]));
                }}
                className="border-border-subtle text-fg-secondary hover:border-danger-border hover:text-danger-fg inline-flex h-8 cursor-default items-center gap-1.5 rounded-md border px-2.5"
              >
                Unavailable task
                <Unlink size={11} aria-hidden />
              </button>
            ) : (
              <button
                key={task.id}
                type="button"
                aria-label={`Open ${task.reference}: ${task.title}`}
                title={`${task.columnName} · ${task.boardName}`}
                onClick={() => {
                  onOpenTask(task);
                }}
                className={cn(
                  "border-border-subtle bg-surface-card hover:border-border-default hover:bg-surface-sunken inline-flex h-8 max-w-full cursor-default items-center gap-2 rounded-md border px-2.5",
                  task.archived ? "opacity-70" : "",
                )}
              >
                <span className="text-accent-fg shrink-0 font-mono text-[9px] tracking-[0.04em]">
                  {task.reference}
                </span>
                <span className="text-fg-primary max-w-56 truncate text-xs">{task.title}</span>
                <span className="text-fg-secondary hidden shrink-0 text-[9px] sm:inline">
                  {task.archived ? "Archived" : task.columnName}
                </span>
              </button>
            ),
          )}
          <TaskLinkMenu
            taskIds={taskIds}
            tasks={tasks}
            onChange={onChange}
            label={linkedCount === 0 ? "Link task" : "Edit links"}
          />
        </dd>
      </div>
      <div className="flex min-h-7 items-start gap-3">
        <dt className="w-24 shrink-0 py-1">Updated</dt>
        <dd className="py-1">{updatedLabel(updatedAt)}</dd>
      </div>
    </dl>
  );
}

interface LinkedWorkProps {
  taskIds: string[];
  tasks: TaskContext[];
  onChange: (ids: string[]) => void;
  onOpenTask: (task: TaskTarget) => void;
}

function TaskLinkMenu({
  taskIds,
  tasks,
  onChange,
  label,
}: {
  taskIds: string[];
  tasks: TaskContext[];
  onChange: (ids: string[]) => void;
  label: string;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="Link tasks to this note"
          className="text-fg-secondary hover:bg-surface-sunken hover:text-fg-primary focus-visible:outline-focus-ring inline-flex h-7 shrink-0 cursor-default items-center gap-1.5 rounded-md px-2 text-2xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <Link2 size={12} aria-hidden />
          {label}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <MenuContent align="end" className="max-h-80 w-80 overflow-y-auto">
          <DropdownMenu.Label className="border-border-subtle text-fg-secondary border-b px-2 py-1.5 font-mono text-[9px] tracking-[0.12em] uppercase">
            Tasks in this project
          </DropdownMenu.Label>
          {tasks.length === 0 ? (
            <DropdownMenu.Item disabled className="text-fg-secondary px-2 py-3 text-xs">
              No tasks are available yet.
            </DropdownMenu.Item>
          ) : (
            tasks.map((task) => {
              const checked = taskIds.includes(task.id);
              return (
                <MenuCheckboxItem
                  key={task.id}
                  checked={checked}
                  onCheckedChange={() => {
                    onChange(
                      checked ? taskIds.filter((id) => id !== task.id) : [...taskIds, task.id],
                    );
                  }}
                >
                  <span className="flex size-3 shrink-0 items-center justify-center">
                    {checked ? <Check size={11} aria-hidden /> : null}
                  </span>
                  <span className="text-accent-fg shrink-0 font-mono text-[9px]">
                    {task.reference}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{task.title}</span>
                  {task.archived ? (
                    <span className="text-fg-secondary shrink-0 text-[9px]">Archived</span>
                  ) : null}
                </MenuCheckboxItem>
              );
            })
          )}
        </MenuContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

const STARTERS = [
  {
    code: "PLAN",
    label: "Project plan",
    body: "# Objective\n\nWhat should be true when this work is finished?\n\n## Approach\n\n- \n\n## Decisions\n\n- \n\n## Verification\n\n- [ ] ",
  },
  {
    code: "DEC",
    label: "Decision record",
    body: "# Decision\n\n## Context\n\n\n## Options considered\n\n1. \n\n## Outcome\n\n\n## Consequences\n\n- ",
  },
  {
    code: "LOG",
    label: "Working log",
    body: "# Working log\n\n## What changed\n\n- \n\n## Open questions\n\n- \n\n## Next move\n\n- [ ] ",
  },
] as const;

function StarterPages({ onChoose }: { onChoose: (body: string) => void }) {
  return (
    <div className="text-fg-secondary mt-5 flex flex-wrap items-center gap-1.5 text-2xs">
      <span className="mr-1">Start with</span>
      <div className="flex flex-wrap items-center gap-1">
        {STARTERS.map((starter) => (
          <button
            key={starter.code}
            type="button"
            onClick={() => {
              onChoose(starter.body);
            }}
            className="hover:bg-surface-sunken hover:text-fg-primary focus-visible:outline-focus-ring inline-flex h-7 cursor-default items-center rounded-md px-2 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {starter.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function EmptyDocument({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 items-center justify-center px-8 py-12">
      <div className="w-full max-w-sm text-center">
        <FileText size={28} strokeWidth={1.4} aria-hidden className="text-fg-secondary mx-auto" />
        <h2 className="text-fg-primary mt-4 text-lg font-semibold">{title}</h2>
        <p className="text-fg-secondary mx-auto mt-2 text-sm leading-relaxed">{body}</p>
        {action === undefined ? null : <div className="mt-5">{action}</div>}
      </div>
    </div>
  );
}

function resolveTasks(taskIds: string[], tasks: TaskContext[]): (TaskContext | null)[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return taskIds.map((id) => byId.get(id) ?? null);
}

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function draftHasChanges(draft: Draft, baseline: SavedDraft): boolean {
  return (
    draft.title !== baseline.title ||
    draft.body !== baseline.body ||
    !sameIds(draft.taskIds, baseline.taskIds)
  );
}

function updatedLabel(timestamp: number): string {
  if (timestamp <= 0) return "Draft";
  const elapsed = Date.now() - timestamp;
  if (elapsed < 60_000) return "Just now";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `${String(minutes)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${String(hours)}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${String(days)}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(timestamp);
}
