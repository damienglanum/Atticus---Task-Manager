import { FileText, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { notifyError } from "@/app/toast";
import { Button, IconButton } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { Note } from "@/lib/bindings/Note";
import type { NotePatch } from "@/lib/bindings/NotePatch";
import { cn } from "@/lib/cn";
import { messageFor } from "@/lib/errors";
import { LIMITS } from "@/lib/schemas";

import { useCreateNote, useDeleteNote, useNotes, useUpdateNote } from "./queries";

/** How long typing pauses before a note is written. */
const SAVE_DELAY_MS = 500;

interface NotesViewProps {
  projectId: string | null;
  projectName: string | null;
}

/**
 * Notes for a project: a list on the left, the note itself on the right.
 *
 * Unlike the task editor, this one saves as you type. A note is one body of
 * prose with nothing else on the screen to lose — there is no draft to discard
 * and nothing a Cancel button would restore you to — so the reasoning that put
 * Save Changes on the task editor does not reach here.
 */
export function NotesView({ projectId, projectName }: NotesViewProps) {
  const notes = useNotes(projectId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Note | null>(null);

  const createNote = useCreateNote(projectId ?? "");
  const deleteNote = useDeleteNote(projectId ?? "");

  const list = notes.data ?? [];
  const selected = list.find((note) => note.id === selectedId) ?? list[0] ?? null;

  if (projectId === null) {
    return (
      <EmptyPage
        title="Notes live in a project"
        body="Choose or create a project from the sidebar, and its notes will appear here."
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-end justify-between gap-3 px-5 pt-5 pb-4">
        <div className="min-w-0">
          <p className="text-fg-secondary text-2xs font-semibold tracking-[0.08em] uppercase">
            {projectName ?? "Workspace"}
          </p>
          <h1 className="text-fg-primary mt-1 truncate text-xl font-semibold tracking-[-0.01em]">
            Notes
          </h1>
        </div>

        <Button
          variant="primary"
          onClick={() => {
            createNote.mutate("Untitled note", {
              onSuccess: (note) => {
                setSelectedId(note.id);
              },
              onError: (error) => {
                notifyError(messageFor(error));
              },
            });
          }}
        >
          <Plus size={15} aria-hidden />
          New note
        </Button>
      </header>

      {notes.isPending ? (
        <p role="status" className="text-fg-secondary px-5 text-sm">
          Loading notes…
        </p>
      ) : list.length === 0 ? (
        <EmptyPage
          title="No notes yet"
          body="A note is somewhere to write that is not a task — a decision, a spec, a scratchpad for the week."
        />
      ) : (
        <div className="grid min-h-0 flex-1 gap-4 px-5 pb-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <ul
            aria-label="Notes"
            className="border-border-subtle bg-surface-column min-h-0 space-y-0.5 overflow-y-auto rounded-xl border p-2"
          >
            {list.map((note) => (
              <li key={note.id}>
                <button
                  type="button"
                  aria-current={note.id === selected?.id ? "true" : undefined}
                  onClick={() => {
                    setSelectedId(note.id);
                  }}
                  className={cn(
                    "flex w-full cursor-default flex-col gap-0.5 rounded-md px-2.5 py-2 text-left",
                    note.id === selected?.id
                      ? "bg-accent-bg text-accent-fg"
                      : "text-fg-secondary hover:bg-surface-sunken",
                  )}
                >
                  <span className="truncate text-sm font-medium">{note.title}</span>
                  <span className="text-fg-secondary truncate text-2xs">
                    {note.body.trim() === "" ? "Empty" : firstLine(note.body)}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {selected === null ? null : (
            <NoteEditor
              key={selected.id}
              note={selected}
              projectId={projectId}
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
            “{deleting.title}” will be removed. This cannot be undone.
          </p>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

function firstLine(body: string): string {
  return body.trim().split("\n")[0] ?? "";
}

function EmptyPage({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="max-w-sm text-center">
        <FileText size={22} aria-hidden className="text-fg-secondary mx-auto" />
        <h2 className="text-fg-primary mt-3 text-lg font-semibold">{title}</h2>
        <p className="text-fg-secondary mt-2 text-sm">{body}</p>
      </div>
    </div>
  );
}

function NoteEditor({
  note,
  projectId,
  onDelete,
}: {
  note: Note;
  projectId: string;
  onDelete: () => void;
}) {
  const update = useUpdateNote(projectId);
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The saved values, so a pending write can tell whether it still has anything
  // to say. Kept in a ref rather than compared against props: props change when
  // the mutation succeeds, and that is precisely when the comparison must not
  // start reporting a difference.
  const saved = useRef({ title: note.title, body: note.body });

  function schedule(next: { title: string; body: string }) {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const titleChanged = next.title !== saved.current.title;
      const bodyChanged = next.body !== saved.current.body;
      if (!titleChanged && !bodyChanged) return;

      // `null` is "leave it alone" on the wire; sending the unchanged value
      // instead would stamp `updated_at` for a field nobody touched.
      const patch: NotePatch = {
        title: titleChanged ? next.title : null,
        body: bodyChanged ? next.body : null,
      };

      saved.current = next;
      update.mutate(
        { id: note.id, patch },
        {
          onError: (error) => {
            notifyError(messageFor(error));
          },
        },
      );
    }, SAVE_DELAY_MS);
  }

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <section
      aria-label={`Note: ${note.title}`}
      className="border-border-subtle flex min-h-0 flex-col rounded-xl border"
    >
      <div className="border-border-subtle flex shrink-0 items-center gap-2 border-b px-4 py-2.5">
        <label htmlFor="note-title" className="sr-only">
          Note title
        </label>
        <input
          id="note-title"
          type="text"
          value={title}
          maxLength={LIMITS.noteTitle}
          onChange={(event) => {
            setTitle(event.target.value);
            schedule({ title: event.target.value, body });
          }}
          className="text-fg-primary min-w-0 flex-1 bg-transparent text-base font-semibold"
        />
        <IconButton label={`Delete ${note.title}`} onClick={onDelete}>
          <Trash2 size={14} aria-hidden />
        </IconButton>
      </div>

      <label htmlFor="note-body" className="sr-only">
        Note body
      </label>
      <textarea
        id="note-body"
        value={body}
        placeholder="Markdown is supported."
        onChange={(event) => {
          setBody(event.target.value);
          schedule({ title, body: event.target.value });
        }}
        className="text-fg-primary placeholder:text-fg-secondary min-h-0 flex-1 resize-none bg-transparent px-4 py-3 font-mono text-sm"
      />
    </section>
  );
}
