import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Bold,
  Check,
  Copy,
  Eye,
  FileSearch,
  FileText,
  FolderOpen,
  Italic,
  Link2,
  List,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useRef, useState } from "react";

import { useShortcuts } from "@/app/useShortcuts";
import { notifyError } from "@/app/toast";
import { Button, IconButton } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DialogPage } from "@/components/ui/Dialog";
import { MenuContent, MenuItem, MenuSeparator } from "@/components/ui/Menu";
import { colorVariable } from "@/features/projects/colors";
import type { Column } from "@/lib/bindings/Column";
import type { Label } from "@/lib/bindings/Label";
import { cn } from "@/lib/cn";
import { messageFor } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { LIMITS, PROJECT_COLORS } from "@/lib/schemas";

import { describeDue, dueState, formatEstimate, parseEstimate } from "./dates";
import { Markdown } from "./Markdown";
import { PRIORITIES } from "./priority";
import {
  draftFrom,
  fileChanges,
  isDirty,
  subtaskChanges,
  taskPatch,
  type DraftFile,
  type DraftSubtask,
  type TaskDraft,
} from "./taskDraft";
import { useTaskDetail } from "./queries";

interface TaskEditorProps {
  taskId: string;
  projectPrefix: string;
  boardName: string;
  /** Every column on this board, so Status can be changed from the editor. */
  columns: Column[];
  onOpenChange: (open: boolean) => void;
  /** Refetches the board and this task after a successful save. */
  onSaved: () => void;
}

/**
 * The task editor.
 *
 * **Draft-and-commit.** Nothing you type reaches the database until you press
 * Save Changes; Cancel throws the draft away. This reverses v1.0's rule, which
 * had no save button at all on the argument that a button is a thing to forget.
 * That argument was sound and it lost to a different one: the design calls for a
 * Cancel, and a Cancel that cannot actually cancel anything is worse than a Save
 * you might forget. Forgetting is now guarded — closing with unsaved work asks
 * first — so the failure mode the old design was avoiding is covered by the
 * guard rather than by the absence of the button.
 *
 * See `taskDraft.ts` for the diffing, which is where the real work is.
 */
export function TaskEditor({
  taskId,
  projectPrefix,
  boardName,
  columns,
  onOpenChange,
  onSaved,
}: TaskEditorProps) {
  const detail = useTaskDetail(taskId);

  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [original, setOriginal] = useState<TaskDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  // Seeded during render rather than in an effect: an effect would paint one
  // frame of an empty editor over a task that is already in the cache.
  if (detail.data !== undefined && draft === null) {
    const seeded = draftFrom(detail.data);
    setDraft(seeded);
    setOriginal(seeded);
  }

  const dirty = original !== null && draft !== null && isDirty(original, draft);

  function requestClose() {
    if (dirty) setConfirmingDiscard(true);
    else onOpenChange(false);
  }

  function update(change: Partial<TaskDraft>) {
    setDraft((current) => (current === null ? current : { ...current, ...change }));
  }

  async function save() {
    if (original === null || draft === null || saving) return;
    setSaving(true);

    try {
      const patch = taskPatch(original, draft);
      if (patch !== null) await ipc.taskUpdate(taskId, patch);

      // Order matters: the checklist and the files are separate rows, and a
      // failure part way through must not leave the task's own columns written
      // and its children not. There is no transaction across commands, so the
      // next best thing is to stop at the first error and say so, leaving the
      // editor open with the draft intact.
      for (const change of subtaskChanges(original, draft)) {
        if (change.kind === "create") {
          const created = await ipc.subtaskCreate(taskId, change.title);
          if (change.done) await ipc.subtaskUpdate(created.id, { done: true });
        } else if (change.kind === "update") {
          // An absent key means "leave it alone", so only what changed is sent.
          await ipc.subtaskUpdate(change.id, {
            ...(change.title === undefined ? {} : { title: change.title }),
            ...(change.done === undefined ? {} : { done: change.done }),
          });
        } else {
          await ipc.subtaskDelete(change.id);
        }
      }

      for (const change of fileChanges(original, draft)) {
        if (change.kind === "add") await ipc.fileRefAdd(taskId, change.path);
        else await ipc.fileRefRemove(change.id);
      }

      const labelsChanged =
        original.labelIds.length !== draft.labelIds.length ||
        original.labelIds.some((id) => !draft.labelIds.includes(id));
      if (labelsChanged) await ipc.taskSetLabels(taskId, draft.labelIds);

      if (draft.columnId !== original.columnId) {
        // Appended to the target column: the editor has no notion of where in
        // that column the task should land, and the bottom is the answer that
        // never displaces somebody else's ordering.
        await ipc.taskMove(taskId, draft.columnId, Number.MAX_SAFE_INTEGER);
      }

      onSaved();
      onOpenChange(false);
    } catch (error) {
      notifyError(messageFor(error));
      setSaving(false);
    }
  }

  // Allowed while typing: finishing a sentence and pressing ⌘Enter is exactly
  // how this is used, and the caret is in a text field at that moment.
  useShortcuts(
    useMemo(
      () => [{ key: "enter", meta: true, whileTyping: true, run: () => void save() }],
      // `save` closes over the draft, so the binding is rebuilt as it changes.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [draft, original, saving],
    ),
  );

  const backLabel = "Back to the board";

  if (detail.isPending || draft === null) {
    return (
      <DialogPage open onOpenChange={onOpenChange} title="Task" backLabel={backLabel}>
        <p role="status" className="text-fg-secondary p-6 text-sm">
          Loading…
        </p>
      </DialogPage>
    );
  }

  if (detail.isError) {
    return (
      <DialogPage open onOpenChange={onOpenChange} title="Task" backLabel={backLabel}>
        <p className="text-danger-fg p-6 text-sm">{messageFor(detail.error)}</p>
      </DialogPage>
    );
  }

  const { availableLabels, task } = detail.data;
  const reference = `${projectPrefix}-${String(task.number)}`;

  return (
    <>
      <DialogPage
        open
        onOpenChange={(open) => {
          if (!open) requestClose();
        }}
        backLabel={backLabel}
        breadcrumb={
          <p className="text-fg-secondary flex items-center gap-1.5 text-2xs font-semibold tracking-[0.08em] uppercase">
            <span className="truncate">{boardName}</span>
            <span aria-hidden>›</span>
            <span className="font-mono" data-numeric>
              {reference}
            </span>
          </p>
        }
        title="Edit task"
        actions={
          <>
            <Button onClick={requestClose} disabled={saving}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                void save();
              }}
              disabled={saving || !dirty}
            >
              <Check size={15} aria-hidden />
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </>
        }
      >
        <div className="mx-auto grid max-w-6xl gap-8 px-6 py-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
          <div className="min-w-0 space-y-6">
            <TitleField
              value={draft.title}
              onChange={(title) => {
                update({ title });
              }}
            />

            <DescriptionPanel
              value={draft.description}
              onChange={(description) => {
                update({ description });
              }}
            />

            <ChecklistPanel
              subtasks={draft.subtasks}
              onChange={(subtasks) => {
                update({ subtasks });
              }}
            />

            <AttachmentsPanel
              files={draft.files}
              onChange={(files) => {
                update({ files });
              }}
            />
          </div>

          <div className="space-y-4">
            <MetadataPanel
              draft={draft}
              columns={columns}
              reference={reference}
              onChange={update}
            />

            <TagsPanel
              available={availableLabels}
              selected={draft.labelIds}
              projectId={task.projectId}
              onChange={(labelIds) => {
                update({ labelIds });
              }}
              onCreated={(label) => {
                update({ labelIds: [...draft.labelIds, label.id] });
                void detail.refetch();
              }}
            />

            <FocusModeCard />
          </div>
        </div>
      </DialogPage>

      {confirmingDiscard ? (
        <ConfirmDialog
          open
          onOpenChange={setConfirmingDiscard}
          title="Discard your changes?"
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          onConfirm={() => {
            setConfirmingDiscard(false);
            onOpenChange(false);
          }}
        >
          <p className="text-fg-secondary text-sm">
            This task has edits that have not been saved. Closing now throws them away.
          </p>
        </ConfirmDialog>
      ) : null}
    </>
  );
}

/** The uppercase heading every panel in the editor carries. */
function PanelHeading({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h3 id={id} className="text-fg-secondary text-2xs font-semibold tracking-[0.08em] uppercase">
      {children}
    </h3>
  );
}

function RailPanel({ children }: { children: ReactNode }) {
  return (
    <div className="border-border-subtle bg-surface-column space-y-4 rounded-xl border p-4">
      {children}
    </div>
  );
}

function TitleField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="space-y-2">
      <label htmlFor="task-title" className="block">
        <PanelHeading>Task title</PanelHeading>
      </label>
      <input
        id="task-title"
        type="text"
        value={value}
        maxLength={LIMITS.taskTitle}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="border-border-subtle bg-surface-column text-fg-primary w-full rounded-lg border px-3.5 py-3 text-base font-medium"
      />
    </div>
  );
}

/** Wraps or prefixes the selection, the way a markdown toolbar is expected to. */
function applyMarkdown(
  textarea: HTMLTextAreaElement,
  kind: "bold" | "italic" | "link" | "list",
): { text: string; selectionStart: number; selectionEnd: number } {
  const { value, selectionStart, selectionEnd } = textarea;
  const selected = value.slice(selectionStart, selectionEnd);

  if (kind === "list") {
    // Whole lines, because a bullet in the middle of one is not a list.
    const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
    const body = value.slice(lineStart, selectionEnd);
    const bulleted = body
      .split("\n")
      .map((line) => (line.startsWith("- ") ? line : `- ${line}`))
      .join("\n");

    return {
      text: value.slice(0, lineStart) + bulleted + value.slice(selectionEnd),
      selectionStart: lineStart,
      selectionEnd: lineStart + bulleted.length,
    };
  }

  const wrap = kind === "bold" ? "**" : kind === "italic" ? "_" : null;
  if (wrap !== null) {
    const next = `${wrap}${selected}${wrap}`;
    return {
      text: value.slice(0, selectionStart) + next + value.slice(selectionEnd),
      selectionStart: selectionStart + wrap.length,
      selectionEnd: selectionStart + wrap.length + selected.length,
    };
  }

  const label = selected === "" ? "text" : selected;
  const next = `[${label}](url)`;
  return {
    text: value.slice(0, selectionStart) + next + value.slice(selectionEnd),
    // Lands on `url`, which is the part you have to replace.
    selectionStart: selectionStart + label.length + 3,
    selectionEnd: selectionStart + label.length + 6,
  };
}

function DescriptionPanel({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [previewing, setPreviewing] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);

  function run(kind: "bold" | "italic" | "link" | "list") {
    const element = textarea.current;
    if (element === null) return;

    const result = applyMarkdown(element, kind);
    onChange(result.text);

    // Restored after React has written the new value, or the caret jumps to the
    // end and the user has to find their place again.
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(result.selectionStart, result.selectionEnd);
    });
  }

  return (
    <section aria-labelledby="description-heading" className="space-y-2">
      <div className="flex items-center justify-between">
        <PanelHeading id="description-heading">Notes &amp; description</PanelHeading>
        <IconButton
          label={previewing ? "Edit the description" : "Preview the description"}
          onClick={() => {
            setPreviewing(!previewing);
          }}
        >
          {previewing ? <Pencil size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
        </IconButton>
      </div>

      <div className="border-border-subtle overflow-hidden rounded-lg border">
        {previewing ? null : (
          <div className="border-border-subtle bg-surface-column flex items-center gap-1 border-b px-2 py-1.5">
            <ToolbarButton
              icon={Bold}
              label="Bold"
              onClick={() => {
                run("bold");
              }}
            />
            <ToolbarButton
              icon={Italic}
              label="Italic"
              onClick={() => {
                run("italic");
              }}
            />
            <ToolbarButton
              icon={Link2}
              label="Link"
              onClick={() => {
                run("link");
              }}
            />
            <ToolbarButton
              icon={List}
              label="Bulleted list"
              onClick={() => {
                run("list");
              }}
            />
          </div>
        )}

        {previewing ? (
          <div className="min-h-40 px-3.5 py-3">
            {value.trim() === "" ? (
              <p className="text-fg-secondary text-sm">No description.</p>
            ) : (
              <Markdown>{value}</Markdown>
            )}
          </div>
        ) : (
          <textarea
            ref={textarea}
            value={value}
            aria-label="Edit description"
            rows={9}
            placeholder="Markdown is supported."
            onChange={(event) => {
              onChange(event.target.value);
            }}
            className="text-fg-primary placeholder:text-fg-secondary w-full resize-y bg-transparent px-3.5 py-3 text-sm"
          />
        )}
      </div>
    </section>
  );
}

function ToolbarButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Bold;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="text-fg-secondary hover:bg-surface-sunken hover:text-fg-primary flex size-7 cursor-default items-center justify-center rounded-md"
    >
      <Icon size={14} aria-hidden />
    </button>
  );
}

let draftKeySeed = 0;
function nextKey(): string {
  draftKeySeed += 1;
  return `draft-${String(draftKeySeed)}`;
}

function ChecklistPanel({
  subtasks,
  onChange,
}: {
  subtasks: DraftSubtask[];
  onChange: (subtasks: DraftSubtask[]) => void;
}) {
  const [adding, setAdding] = useState("");
  const done = subtasks.filter((item) => item.done).length;

  function add() {
    const title = adding.trim();
    if (title === "") return;
    onChange([...subtasks, { key: nextKey(), id: null, title, done: false }]);
    setAdding("");
  }

  return (
    <section aria-labelledby="checklist-heading" className="space-y-2">
      <div className="flex items-center justify-between">
        <PanelHeading id="checklist-heading">Checklist</PanelHeading>
        {subtasks.length === 0 ? null : (
          <span
            className="bg-surface-sunken text-fg-secondary rounded px-1.5 py-0.5 text-2xs font-medium tracking-[0.06em] uppercase"
            data-numeric
          >
            {done}/{subtasks.length} done
          </span>
        )}
      </div>

      <div className="border-border-subtle divide-border-subtle divide-y overflow-hidden rounded-lg border">
        {subtasks.map((item, index) => (
          <div key={item.key} className="group flex items-center gap-3 px-3.5 py-2.5">
            <input
              type="checkbox"
              id={`checklist-${item.key}`}
              checked={item.done}
              onChange={(event) => {
                const next = [...subtasks];
                next[index] = { ...item, done: event.target.checked };
                onChange(next);
              }}
              className="accent-accent-solid size-4 shrink-0"
            />
            <label htmlFor={`checklist-${item.key}`} className="sr-only">
              {item.title}
            </label>
            <input
              type="text"
              value={item.title}
              aria-label={`Checklist item: ${item.title}`}
              onChange={(event) => {
                const next = [...subtasks];
                next[index] = { ...item, title: event.target.value };
                onChange(next);
              }}
              className={cn(
                "min-w-0 flex-1 bg-transparent text-sm",
                item.done ? "text-fg-secondary line-through" : "text-fg-primary",
              )}
            />
            <IconButton
              label={`Remove ${item.title}`}
              className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              onClick={() => {
                onChange(subtasks.filter((candidate) => candidate.key !== item.key));
              }}
            >
              <Trash2 size={13} aria-hidden />
            </IconButton>
          </div>
        ))}

        <div className="flex items-center gap-3 px-3.5 py-2.5">
          <Plus size={14} aria-hidden className="text-fg-secondary shrink-0" />
          <input
            type="text"
            value={adding}
            aria-label="Add a new checklist item"
            placeholder="Add a new checklist item…"
            maxLength={LIMITS.taskTitle}
            onChange={(event) => {
              setAdding(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                // Not a submit: this lives inside the editor, and Enter here
                // means "another item", the same as it does on the board.
                event.preventDefault();
                add();
              }
            }}
            onBlur={add}
            className="text-fg-primary placeholder:text-fg-secondary min-w-0 flex-1 bg-transparent text-sm"
          />
        </div>
      </div>
    </section>
  );
}

function AttachmentsPanel({
  files,
  onChange,
}: {
  files: DraftFile[];
  onChange: (files: DraftFile[]) => void;
}) {
  async function relocate(file: DraftFile) {
    if (file.id === null) return;
    try {
      const path = await ipc.pickFile();
      if (path === null) return;

      const moved = await ipc.fileRefRelocate(file.id, path);
      onChange(
        files.map((candidate) =>
          candidate.key === file.key
            ? {
                ...candidate,
                path: moved.path,
                displayName: moved.displayName,
                found: moved.found,
              }
            : candidate,
        ),
      );
    } catch (error) {
      notifyError(messageFor(error));
    }
  }

  async function link() {
    try {
      const path = await ipc.pickFile();
      if (path === null) return;

      const displayName = path.split("/").pop() ?? path;
      onChange([...files, { key: nextKey(), id: null, path, displayName, found: true }]);
    } catch (error) {
      notifyError(messageFor(error));
    }
  }

  return (
    <section aria-labelledby="attachments-heading" className="space-y-2">
      <PanelHeading id="attachments-heading">Attachments</PanelHeading>

      <div className="grid gap-2 sm:grid-cols-2">
        {files.map((file) => (
          <div
            key={file.key}
            className={cn(
              "flex items-center gap-3 rounded-lg border px-3 py-2.5",
              file.found
                ? "border-border-subtle bg-surface-column"
                : "border-warning-border bg-warning-bg",
            )}
          >
            <span
              aria-hidden
              className="bg-surface-sunken text-fg-secondary flex size-8 shrink-0 items-center justify-center rounded-md"
            >
              <FileText size={15} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-fg-primary block truncate text-sm font-medium">
                {file.displayName}
              </span>
              {/* The remembered path is shown either way. For a file that has
                  moved it is the only clue to where it went, so replacing it
                  with the warning would take away the one useful thing. */}
              <span className="text-fg-secondary block truncate text-2xs" title={file.path}>
                {file.path}
              </span>
              {file.found ? null : (
                <span className="text-warning-fg block text-2xs">
                  This file is not where it was
                </span>
              )}
            </span>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <IconButton label={`Actions for ${file.displayName}`}>
                  <MoreHorizontal size={14} aria-hidden />
                </IconButton>
              </DropdownMenu.Trigger>

              <DropdownMenu.Portal>
                <MenuContent>
                  {/*
                    Reveal and Locate act at once rather than waiting for Save.
                    Neither edits the task: one opens a Finder window, and the
                    other repairs a link to a file that has moved. Cancelling an
                    edit should not re-break a path the user just fixed.
                  */}
                  {file.id === null || !file.found ? null : (
                    // Absent for a file that is not there: revealing it would
                    // open a Finder window on nothing and look like a failure.
                    <MenuItem
                      onSelect={() => {
                        void ipc.fileRefReveal(file.id ?? "").catch((error: unknown) => {
                          notifyError(messageFor(error));
                        });
                      }}
                    >
                      <FolderOpen size={13} aria-hidden />
                      Reveal in Finder
                    </MenuItem>
                  )}

                  {file.found || file.id === null ? null : (
                    <MenuItem
                      onSelect={() => {
                        void relocate(file);
                      }}
                    >
                      <FileSearch size={13} aria-hidden />
                      Locate this file…
                    </MenuItem>
                  )}

                  <MenuSeparator />
                  <MenuItem
                    destructive
                    onSelect={() => {
                      onChange(files.filter((candidate) => candidate.key !== file.key));
                    }}
                  >
                    <X size={13} aria-hidden />
                    Remove
                  </MenuItem>
                </MenuContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        ))}

        {/*
          "Link", not "upload". Nothing is copied anywhere — Atticus records the
          path and the file stays exactly where you left it (ADR-0007). Calling
          the control Upload would promise a copy that does not exist, and the
          promise only fails much later, when the original is moved.
        */}
        <button
          type="button"
          onClick={() => {
            void link();
          }}
          className="border-border-default text-fg-secondary hover:border-border-strong hover:text-fg-primary flex cursor-default items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-4 text-xs font-semibold tracking-[0.06em] uppercase"
        >
          <Paperclip size={14} aria-hidden />
          Link files
        </button>
      </div>
    </section>
  );
}

const SELECT_CLASS =
  "border-border-subtle bg-surface-card text-fg-primary w-full rounded-md border px-2 py-1.5 text-sm";

function MetadataPanel({
  draft,
  columns,
  reference,
  onChange,
}: {
  draft: TaskDraft;
  columns: Column[];
  reference: string;
  onChange: (change: Partial<TaskDraft>) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [estimateDraft, setEstimateDraft] = useState(formatEstimate(draft.estimateMinutes));
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const state = dueState(draft.dueDate);

  return (
    <RailPanel>
      <div className="flex items-center justify-between">
        <PanelHeading>Metadata</PanelHeading>
        <span className="flex items-center gap-1">
          <span className="text-fg-secondary font-mono text-2xs" data-numeric>
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
        </span>
      </div>
      {copied ? (
        <span role="status" className="sr-only">
          Copied
        </span>
      ) : null}

      <div>
        <label htmlFor="task-status" className="mb-1.5 block">
          <PanelHeading>Status</PanelHeading>
        </label>
        {/*
          A task's status *is* the column it sits in — there is no second field
          that could disagree with the board. Changing it here moves the card.
        */}
        <select
          id="task-status"
          value={draft.columnId}
          onChange={(event) => {
            onChange({ columnId: event.target.value });
          }}
          className={SELECT_CLASS}
        >
          {columns.map((column) => (
            <option key={column.id} value={column.id}>
              {column.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="task-priority" className="mb-1.5 block">
          <PanelHeading>Priority</PanelHeading>
        </label>
        <select
          id="task-priority"
          value={draft.priority}
          onChange={(event) => {
            onChange({ priority: Number(event.target.value) });
          }}
          className={SELECT_CLASS}
        >
          {PRIORITIES.map((level) => (
            <option key={level.value} value={level.value}>
              {level.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="task-due" className="mb-1.5 block">
          <PanelHeading>Due date</PanelHeading>
        </label>
        <input
          id="task-due"
          type="date"
          value={draft.dueDate ?? ""}
          onChange={(event) => {
            onChange({ dueDate: event.target.value === "" ? null : event.target.value });
          }}
          className={SELECT_CLASS}
        />
        {/* Always says which state the field is in, including "none". WebKit
            draws today's date greyed inside an empty date input, so an unset due
            date looks exactly like one set to today — the one pair of states a
            due-date control must never confuse. */}
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
          {draft.dueDate === null ? "No due date" : describeDue(draft.dueDate)}
        </p>
      </div>

      <div>
        <label htmlFor="task-estimate" className="mb-1.5 block">
          <PanelHeading>Estimate</PanelHeading>
        </label>
        <input
          id="task-estimate"
          type="text"
          value={estimateDraft}
          placeholder="e.g. 1h 30m"
          aria-invalid={estimateError !== null || undefined}
          aria-describedby={estimateError === null ? undefined : "task-estimate-error"}
          onChange={(event) => {
            setEstimateDraft(event.target.value);
          }}
          onBlur={() => {
            const parsed = parseEstimate(estimateDraft);
            if (parsed === "invalid") {
              setEstimateError("Try 90, 1h 30m, or 2h.");
              return;
            }
            setEstimateError(null);
            onChange({ estimateMinutes: parsed });
          }}
          className={SELECT_CLASS}
        />
        {estimateError === null ? null : (
          <p id="task-estimate-error" role="alert" className="text-danger-fg mt-1 text-2xs">
            {estimateError}
          </p>
        )}
      </div>
    </RailPanel>
  );
}

function TagsPanel({
  available,
  selected,
  projectId,
  onChange,
  onCreated,
}: {
  available: Label[];
  selected: string[];
  projectId: string;
  onChange: (labelIds: string[]) => void;
  onCreated: (label: Label) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const chosen = selected
    .map((id) => available.find((label) => label.id === id))
    .filter((label): label is Label => label !== undefined);
  const rest = available.filter((label) => !selected.includes(label.id));

  async function create() {
    const trimmed = name.trim();
    if (trimmed === "" || busy) return;

    const existing = available.find((label) => label.name.toLowerCase() === trimmed.toLowerCase());
    if (existing !== undefined) {
      if (!selected.includes(existing.id)) onChange([...selected, existing.id]);
      setName("");
      setAdding(false);
      return;
    }

    setBusy(true);
    try {
      // Created immediately, unlike everything else in the editor. A label
      // belongs to the project rather than to this task, so Cancel has no
      // business deleting one that another task may already be using.
      const color = PROJECT_COLORS[available.length % PROJECT_COLORS.length] ?? "slate";
      const label = await ipc.labelCreate(projectId, { name: trimmed, color });
      onCreated(label);
      setName("");
      setAdding(false);
    } catch (error) {
      notifyError(messageFor(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <RailPanel>
      <PanelHeading>Tags</PanelHeading>

      <div className="flex flex-wrap gap-1.5">
        {chosen.map((label) => (
          <span
            key={label.id}
            className="bg-surface-sunken text-fg-secondary inline-flex items-center gap-1.5 rounded-md py-0.5 pr-0.5 pl-1.5 text-2xs font-medium tracking-[0.06em] uppercase"
          >
            <span
              aria-hidden
              className="size-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: colorVariable(label.color) }}
            />
            {label.name}
            <button
              type="button"
              aria-label={`Remove ${label.name}`}
              onClick={() => {
                onChange(selected.filter((id) => id !== label.id));
              }}
              className="hover:text-fg-primary flex size-4 cursor-default items-center justify-center rounded"
            >
              <X size={11} aria-hidden />
            </button>
          </span>
        ))}

        {adding ? null : (
          <button
            type="button"
            onClick={() => {
              setAdding(true);
            }}
            className="border-border-default text-fg-secondary hover:text-fg-primary inline-flex cursor-default items-center gap-1 rounded-md border border-dashed px-1.5 py-0.5 text-2xs font-medium tracking-[0.06em] uppercase"
          >
            <Plus size={11} aria-hidden />
            Add tag
          </button>
        )}
      </div>

      {adding ? (
        <div className="space-y-2">
          <input
            ref={(element) => {
              // Focused on mount rather than with `autoFocus`, which fires
              // before assistive technology has finished announcing the panel.
              element?.focus();
            }}
            type="text"
            value={name}
            aria-label="Tag name"
            placeholder="Tag name"
            maxLength={LIMITS.noteTitle}
            onChange={(event) => {
              setName(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void create();
              }
              if (event.key === "Escape") {
                setAdding(false);
                setName("");
              }
            }}
            className="border-border-subtle bg-surface-card text-fg-primary w-full rounded-md border px-2 py-1.5 text-sm"
          />

          {rest.length === 0 ? null : (
            <ul className="max-h-40 space-y-0.5 overflow-y-auto">
              {rest
                .filter((label) => label.name.toLowerCase().includes(name.trim().toLowerCase()))
                .map((label) => (
                  <li key={label.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange([...selected, label.id]);
                        setName("");
                        setAdding(false);
                      }}
                      className="text-fg-secondary hover:bg-surface-sunken hover:text-fg-primary flex w-full cursor-default items-center gap-2 rounded px-1.5 py-1 text-left text-xs"
                    >
                      <span
                        aria-hidden
                        className="size-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: colorVariable(label.color) }}
                      />
                      {label.name}
                    </button>
                  </li>
                ))}
            </ul>
          )}

          <Button
            size="sm"
            variant="primary"
            disabled={name.trim() === "" || busy}
            onClick={() => {
              void create();
            }}
          >
            Add “{name.trim()}”
          </Button>
        </div>
      ) : null}
    </RailPanel>
  );
}

/**
 * The decorative card at the foot of the rail.
 *
 * A gradient drawn in CSS rather than an image: the application ships offline
 * and has no asset pipeline, and a decorative texture is not worth either. It is
 * `aria-hidden` because it says nothing a screen reader needs.
 */
function FocusModeCard() {
  return (
    <div aria-hidden className="border-border-subtle overflow-hidden rounded-xl border">
      <div
        className="h-40"
        style={{
          background:
            "radial-gradient(120% 90% at 20% 15%, var(--cyan-6) 0%, transparent 55%), " +
            "radial-gradient(110% 80% at 85% 25%, var(--plum-6) 0%, transparent 50%), " +
            "radial-gradient(130% 100% at 60% 95%, var(--teal-5) 0%, transparent 60%), " +
            "var(--color-surface-sunken)",
        }}
      />
      <div className="bg-surface-column px-4 py-3 text-center">
        <p className="text-fg-secondary text-2xs font-semibold tracking-[0.08em] uppercase">
          Focus mode
        </p>
        <p className="text-fg-secondary mt-0.5 text-2xs italic">Your sanctuary for deep work</p>
      </div>
    </div>
  );
}
