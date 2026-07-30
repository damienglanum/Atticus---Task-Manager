import { Check, Copy, Eye, Pencil } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

import { notifyError } from "@/app/toast";
import { IconButton } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import type { TaskPatch } from "@/lib/bindings/TaskPatch";
import { messageFor } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { LIMITS } from "@/lib/schemas";
import { cn } from "@/lib/cn";

import { describeDue, dueState, formatEstimate, parseEstimate } from "./dates";
import { FileRefList } from "./FileRefList";
import { LabelPicker } from "./LabelPicker";
import { Markdown } from "./Markdown";
import { PRIORITIES } from "./priority";
import {
  useAddFileRef,
  useCreateLabel,
  useCreateSubtask,
  useDeleteSubtask,
  useEditTask,
  useRelocateFileRef,
  useRemoveFileRef,
  useSetTaskLabels,
  useTaskDetail,
  useUpdateSubtask,
} from "./queries";
import { SubtaskList } from "./SubtaskList";

/** How long typing pauses before an edit is written (US-10 AC2). */
export const AUTOSAVE_DELAY_MS = 400;

/**
 * Where debounced fields register a "write whatever you are holding" callback.
 *
 * The editor calls every one of them *before* it closes. Doing it in an unmount
 * cleanup instead looks equivalent and is not: a TanStack mutation dispatched
 * from a component that is already unmounting never reaches the network, so the
 * last thing typed was silently dropped. Found end to end, by closing the dialog
 * inside the debounce window.
 */
const FlushContext = createContext<{ register: (flush: () => void) => () => void } | null>(null);

function useRegisterFlush(flush: () => void) {
  const context = useContext(FlushContext);
  const latest = useRef(flush);
  useEffect(() => {
    latest.current = flush;
  });

  useEffect(() => {
    if (context === null) return undefined;
    return context.register(() => {
      latest.current();
    });
  }, [context]);
}

interface TaskEditorProps {
  taskId: string;
  boardId: string;
  projectPrefix: string;
  onOpenChange: (open: boolean) => void;
}

/**
 * The full task editor.
 *
 * There is no Save button. Every field writes on its own — debounced while
 * typing, immediately on blur and on close (US-10 AC2) — because a save button
 * is a thing to forget, and forgetting it costs the user their writing.
 */
export function TaskEditor({ taskId, boardId, projectPrefix, onOpenChange }: TaskEditorProps) {
  const pendingFlushes = useRef(new Set<() => void>());

  // `useMemo`, not `useRef`: this value is read during render to build the
  // context, and a ref read in render is exactly what the rules of React warn
  // about. The set it closes over stays in a ref, where mutation belongs.
  const flushRegistry = useMemo(
    () => ({
      register: (flush: () => void) => {
        pendingFlushes.current.add(flush);
        return () => {
          pendingFlushes.current.delete(flush);
        };
      },
    }),
    [],
  );

  /** Writes every field that is mid-debounce, then closes. */
  function close(open: boolean) {
    if (!open) {
      for (const flush of pendingFlushes.current) flush();
    }
    onOpenChange(open);
  }

  const detail = useTaskDetail(taskId);
  const editTask = useEditTask(boardId, taskId);

  const createSubtask = useCreateSubtask(boardId, taskId);
  const updateSubtask = useUpdateSubtask(boardId, taskId);
  const deleteSubtask = useDeleteSubtask(boardId, taskId);
  const setLabels = useSetTaskLabels(boardId, taskId);
  const createLabel = useCreateLabel(boardId, taskId, detail.data?.task.projectId ?? "");
  const addFile = useAddFileRef(boardId, taskId);
  const relocateFile = useRelocateFileRef(boardId, taskId);
  const removeFile = useRemoveFileRef(boardId, taskId);

  function fail(error: unknown) {
    notifyError(messageFor(error));
  }

  const save = (patch: TaskPatch) => {
    editTask.mutate(patch, { onError: fail });
  };

  if (detail.isPending) {
    return (
      <Dialog open onOpenChange={close} title="Task">
        <p role="status" className="text-fg-secondary text-xs">
          Loading…
        </p>
      </Dialog>
    );
  }

  if (detail.isError) {
    return (
      <Dialog open onOpenChange={close} title="Task">
        <p className="text-danger-fg text-xs">{messageFor(detail.error)}</p>
      </Dialog>
    );
  }

  const { task, subtasks, labelIds, fileRefs, availableLabels } = detail.data;
  const reference = `${projectPrefix}-${String(task.number)}`;

  return (
    <Dialog open onOpenChange={close} title={reference} wide>
      <FlushContext value={flushRegistry}>
        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_15rem]">
          <div className="min-w-0 space-y-5">
            <TitleField value={task.title} onSave={save} />
            <DescriptionField value={task.description} onSave={save} />
            <SubtaskList
              subtasks={subtasks}
              onAdd={(title) => {
                createSubtask.mutate(title, { onError: fail });
              }}
              onToggle={(subtask, done) => {
                updateSubtask.mutate({ id: subtask.id, patch: { done } }, { onError: fail });
              }}
              onRename={(subtask, title) => {
                updateSubtask.mutate({ id: subtask.id, patch: { title } }, { onError: fail });
              }}
              onDelete={(subtask) => {
                deleteSubtask.mutate(subtask.id, { onError: fail });
              }}
            />
          </div>

          <div className="space-y-5">
            <ReferenceRow reference={reference} />
            <PriorityField value={task.priority} onSave={save} />
            <DueDateField value={task.dueDate} onSave={save} />
            <EstimateField value={task.estimateMinutes} onSave={save} />

            <LabelPicker
              available={availableLabels}
              selected={labelIds}
              creating={createLabel.isPending}
              onChange={(next) => {
                setLabels.mutate(next, { onError: fail });
              }}
              onCreate={(name, color) => {
                createLabel.mutate({ name, color }, { onError: fail });
              }}
            />

            <FileRefList
              fileRefs={fileRefs}
              busy={addFile.isPending || relocateFile.isPending || removeFile.isPending}
              onAdd={() => {
                void (async () => {
                  try {
                    const path = await ipc.pickFile();
                    if (path !== null) addFile.mutate(path, { onError: fail });
                  } catch (error) {
                    fail(error);
                  }
                })();
              }}
              onLocate={(fileRef) => {
                void (async () => {
                  try {
                    const path = await ipc.pickFile();
                    if (path !== null)
                      relocateFile.mutate({ id: fileRef.id, path }, { onError: fail });
                  } catch (error) {
                    fail(error);
                  }
                })();
              }}
              onReveal={(fileRef) => {
                void ipc.fileRefReveal(fileRef.id).catch(fail);
              }}
              onRemove={(fileRef) => {
                removeFile.mutate(fileRef.id, { onError: fail });
              }}
            />
          </div>
        </div>
      </FlushContext>
    </Dialog>
  );
}

/**
 * Writes after a pause in typing, immediately on blur, and immediately before
 * the editor closes.
 *
 * The last of those is registered with the editor rather than done in an unmount
 * cleanup — see `FlushContext` for why the obvious version silently loses the
 * final edit.
 */
function useAutosave(value: string, commit: (next: string) => void) {
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ draft, value, commit });
  useEffect(() => {
    latest.current = { draft, value, commit };
  });

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  useRegisterFlush(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    const { draft: pending, value: saved, commit: write } = latest.current;
    if (pending !== saved) write(pending);
  });

  function change(next: string) {
    setDraft(next);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (next !== latest.current.value) commit(next);
    }, AUTOSAVE_DELAY_MS);
  }

  function flush() {
    if (timer.current !== null) clearTimeout(timer.current);
    if (draft !== value) commit(draft);
  }

  return { draft, change, flush };
}

function TitleField({ value, onSave }: { value: string; onSave: (patch: TaskPatch) => void }) {
  const { draft, change, flush } = useAutosave(value, (title) => {
    if (title.trim() !== "") onSave({ title });
  });

  return (
    <div>
      <label htmlFor="task-title" className="sr-only">
        Title
      </label>
      <textarea
        id="task-title"
        value={draft}
        rows={2}
        maxLength={LIMITS.taskTitle}
        onChange={(event) => {
          change(event.target.value);
        }}
        onBlur={flush}
        className="text-fg-primary border-border-strong focus-visible:border-accent-border w-full resize-none rounded-md border bg-transparent px-2 py-1.5 text-sm font-semibold"
      />
    </div>
  );
}

function DescriptionField({
  value,
  onSave,
}: {
  value: string;
  onSave: (patch: TaskPatch) => void;
}) {
  const [editing, setEditing] = useState(value === "");
  const { draft, change, flush } = useAutosave(value, (description) => {
    onSave({ description });
  });

  return (
    <section aria-labelledby="description-heading" className="space-y-2">
      <div className="flex items-center justify-between">
        <h3
          id="description-heading"
          className="text-fg-secondary text-xs font-semibold tracking-[0.06em] uppercase"
        >
          Description
        </h3>
        <IconButton
          label={editing ? "Preview the description" : "Edit the description"}
          onClick={() => {
            if (editing) flush();
            setEditing(!editing);
          }}
        >
          {editing ? <Eye size={13} aria-hidden /> : <Pencil size={13} aria-hidden />}
        </IconButton>
      </div>

      {editing ? (
        <textarea
          value={draft}
          // Not "Description": the section is already named that, and two
          // things with the same name in one region is ambiguous to a screen
          // reader as well as to a test.
          aria-label="Edit description"
          rows={8}
          placeholder="Markdown is supported."
          onChange={(event) => {
            change(event.target.value);
          }}
          onBlur={flush}
          className="text-fg-primary border-border-strong focus-visible:border-accent-border placeholder:text-fg-secondary w-full resize-y rounded-md border bg-transparent px-2 py-1.5 font-mono text-xs"
        />
      ) : draft === "" ? (
        <p className="text-fg-secondary text-xs">No description.</p>
      ) : (
        <Markdown>{draft}</Markdown>
      )}
    </section>
  );
}

function ReferenceRow({ reference }: { reference: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex items-center gap-2">
      <span className="text-fg-secondary font-mono text-xs" data-numeric>
        {reference}
      </span>
      <IconButton
        label={`Copy ${reference}`}
        onClick={() => {
          void navigator.clipboard.writeText(reference).then(
            () => {
              setCopied(true);
              setTimeout(() => {
                setCopied(false);
              }, 1500);
            },
            () => {
              notifyError("The task ID could not be copied to the clipboard.");
            },
          );
        }}
      >
        {copied ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />}
      </IconButton>
      {copied ? (
        <span role="status" className="text-fg-secondary text-2xs">
          Copied
        </span>
      ) : null}
    </div>
  );
}

function PriorityField({ value, onSave }: { value: number; onSave: (patch: TaskPatch) => void }) {
  return (
    <fieldset>
      <legend className="text-fg-secondary mb-1.5 text-xs font-semibold tracking-[0.06em] uppercase">
        Priority
      </legend>
      <div className="flex flex-wrap gap-1">
        {PRIORITIES.map((level) => {
          const Icon = level.icon;
          const selected = level.value === value;
          return (
            <label key={level.value} className="cursor-default">
              <input
                type="radio"
                name="priority"
                value={level.value}
                checked={selected}
                onChange={() => {
                  onSave({ priority: level.value });
                }}
                className="peer sr-only"
              />
              <span
                className={cn(
                  "border-border-subtle peer-focus-visible:ring-accent-border flex items-center gap-1 rounded border px-1.5 py-1 text-2xs peer-focus-visible:ring-2",
                  selected ? "bg-surface-sunken text-fg-primary border-border-strong" : level.tone,
                )}
              >
                <Icon size={12} aria-hidden />
                {level.label}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function DueDateField({
  value,
  onSave,
}: {
  value: string | null;
  onSave: (patch: TaskPatch) => void;
}) {
  const state = dueState(value);
  const description = describeDue(value);

  return (
    <div>
      <label
        htmlFor="task-due"
        className="text-fg-secondary mb-1.5 block text-xs font-semibold tracking-[0.06em] uppercase"
      >
        Due date
      </label>
      <input
        id="task-due"
        type="date"
        value={value ?? ""}
        onChange={(event) => {
          const next = event.target.value;
          onSave(next === "" ? { clearDueDate: true } : { dueDate: next });
        }}
        className="border-border-strong bg-surface-raised text-fg-primary w-full rounded-md border px-2 py-1 text-xs"
      />
      {/* Always says which state the field is in, including "none".

          WebKit draws today's date greyed inside an *empty* `input[type=date]`
          rather than a `dd-mm-yyyy` placeholder, so an unset due date looks
          exactly like one set to today — the one pair of states a due-date
          control must never confuse. Noted in M6's visual review and fixed here.

          The words are the fix. Replacing the native control would cost a
          keyboard-accessible, locale-aware date picker to solve a labelling
          problem, and product-spec §10 wants every state carrying words anyway. */}
      <p
        className={cn(
          "mt-1 text-2xs",
          state === "overdue"
            ? "text-danger-fg"
            : state === "today" || state === "soon"
              ? "text-warning-fg"
              : "text-fg-secondary",
        )}
      >
        {description === "" ? "No due date" : description}
      </p>
    </div>
  );
}

function EstimateField({
  value,
  onSave,
}: {
  value: number | null;
  onSave: (patch: TaskPatch) => void;
}) {
  const [draft, setDraft] = useState(formatEstimate(value));
  const [error, setError] = useState<string | null>(null);

  function commit() {
    const parsed = parseEstimate(draft);
    if (parsed === "invalid") {
      setError("Try 90, 1h 30m, or 2h.");
      return;
    }
    setError(null);
    onSave(parsed === null ? { clearEstimate: true } : { estimateMinutes: parsed });
  }

  return (
    <div>
      <label
        htmlFor="task-estimate"
        className="text-fg-secondary mb-1.5 block text-xs font-semibold tracking-[0.06em] uppercase"
      >
        Estimate
      </label>
      <input
        id="task-estimate"
        type="text"
        value={draft}
        placeholder="e.g. 1h 30m"
        aria-invalid={error !== null || undefined}
        aria-describedby={error === null ? undefined : "task-estimate-error"}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onBlur={commit}
        className="border-border-strong bg-surface-raised text-fg-primary placeholder:text-fg-secondary w-full rounded-md border px-2 py-1 text-xs"
      />
      {error === null ? null : (
        <p id="task-estimate-error" role="alert" className="text-danger-fg mt-1 text-2xs">
          {error}
        </p>
      )}
    </div>
  );
}
