import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Bold,
  Check,
  Clock3,
  Copy,
  Eye,
  ExternalLink,
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
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useShortcuts } from "@/app/useShortcuts";
import { notifyError } from "@/app/toast";
import { BlurFade } from "@/components/magicui/BlurFade";
import { Button, IconButton } from "@/components/ui/Button";
import { ChoiceField } from "@/components/ui/ChoiceField";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DatePicker } from "@/components/ui/DatePicker";
import { DialogPage } from "@/components/ui/Dialog";
import { LogoMark } from "@/components/ui/Logo";
import { MenuContent, MenuItem, MenuSeparator } from "@/components/ui/Menu";
import { useIdlePreview } from "@/components/ui/useIdlePreview";
import { colorVariable, labelColorVariable } from "@/features/projects/colors";
import type { Column } from "@/lib/bindings/Column";
import type { Label } from "@/lib/bindings/Label";
import { cn } from "@/lib/cn";
import { messageFor } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { normalizeWebUrl, webLinkName } from "@/lib/links";
import { LIMITS, type ProjectColor } from "@/lib/schemas";

import { describeDue, dueState, formatEstimate, parseEstimate } from "./dates";
import { Markdown } from "./Markdown";
import { PRIORITIES } from "./priority";
import {
  draftFrom,
  fileChanges,
  isDirty,
  linkChanges,
  subtaskChanges,
  taskPatch,
  type DraftFile,
  type DraftLink,
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

      // Order matters: the checklist, files, and links are separate rows, and a
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

      for (const change of linkChanges(original, draft)) {
        if (change.kind === "add") await ipc.linkRefAdd(taskId, change.url);
        else await ipc.linkRefRemove(change.id);
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
        bodyClassName="overflow-hidden"
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
        <BlurFade className="h-full min-h-0 w-full overflow-y-auto lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:overflow-hidden">
          <main data-task-editor-main className="min-w-0 lg:min-h-0 lg:overflow-y-auto">
            <div className="px-6 py-7 sm:px-8 xl:px-10 2xl:px-12">
              <TitleField
                value={draft.title}
                onChange={(title) => {
                  update({ title });
                }}
              />

              <div className="mt-8 grid items-start gap-8 2xl:grid-cols-[minmax(32rem,1.45fr)_minmax(20rem,0.75fr)] 2xl:gap-10">
                <DescriptionPanel
                  value={draft.description}
                  onChange={(description) => {
                    update({ description });
                  }}
                />

                <div className="min-w-0 space-y-8 2xl:border-l 2xl:border-border-subtle 2xl:pl-10">
                  <ChecklistPanel
                    subtasks={draft.subtasks}
                    onChange={(subtasks) => {
                      update({ subtasks });
                    }}
                  />

                  <AttachmentsPanel
                    files={draft.files}
                    links={draft.links}
                    onFilesChange={(files) => {
                      update({ files });
                    }}
                    onLinksChange={(links) => {
                      update({ links });
                    }}
                  />
                </div>
              </div>
            </div>
          </main>

          <aside
            data-task-editor-rail
            className="border-border-subtle flex min-w-0 flex-col border-t px-6 py-7 lg:min-h-0 lg:overflow-y-auto lg:border-t-0 lg:border-l lg:px-7"
          >
            <div className="space-y-6">
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
                  update({
                    labelIds: draft.labelIds.includes(label.id)
                      ? draft.labelIds
                      : [...draft.labelIds, label.id],
                  });
                  void detail.refetch();
                }}
              />
            </div>

            <div className="mt-auto ml-auto w-full max-w-80 shrink-0 pt-6 lg:max-w-none">
              <FocusModeCard />
            </div>
          </aside>
        </BlurFade>
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

/** A quiet but clear section heading, matching the approved detail-page hierarchy. */
function PanelHeading({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h3 id={id} className="text-fg-primary text-base font-semibold tracking-[-0.01em]">
      {children}
    </h3>
  );
}

function RailPanel({ children }: { children: ReactNode }) {
  return <section className="border-border-subtle space-y-5 border-b pb-6">{children}</section>;
}

function TitleField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="border-border-subtle border-b pb-7">
      <label htmlFor="task-title" className="sr-only">
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
        className="text-fg-primary placeholder:text-fg-secondary w-full bg-transparent p-0 text-2xl leading-tight font-semibold tracking-[-0.03em]"
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
  const { previewing, beginEditing, showPreview, previewAfterPause } = useIdlePreview();
  const textarea = useRef<HTMLTextAreaElement>(null);

  function edit() {
    beginEditing();
    requestAnimationFrame(() => {
      textarea.current?.focus();
    });
  }

  function run(kind: "bold" | "italic" | "link" | "list") {
    const element = textarea.current;
    if (element === null) return;

    const result = applyMarkdown(element, kind);
    onChange(result.text);
    previewAfterPause(result.text.trim() !== "");

    // Restored after React has written the new value, or the caret jumps to the
    // end and the user has to find their place again.
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(result.selectionStart, result.selectionEnd);
    });
  }

  return (
    <section aria-labelledby="description-heading" className="min-w-0 space-y-3">
      <div className="flex items-center justify-between">
        <PanelHeading id="description-heading">Description</PanelHeading>
        <button
          type="button"
          aria-label={previewing ? "Edit the description" : "Preview the description"}
          onClick={previewing ? edit : showPreview}
          className="border-border-default text-fg-secondary hover:bg-surface-sunken hover:text-fg-primary inline-flex h-7 cursor-default items-center gap-1.5 rounded-sm border px-2 text-2xs font-medium"
        >
          {previewing ? <Pencil size={12} aria-hidden /> : <Eye size={12} aria-hidden />}
          {previewing ? "Write" : "Preview"}
        </button>
      </div>

      <div className="border-border-subtle overflow-hidden border-y">
        {previewing ? null : (
          <div
            role="toolbar"
            aria-label="Description formatting"
            className="border-border-subtle flex items-center gap-1 border-b px-1 py-2"
          >
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
          <div data-selectable className="min-h-72 px-1 py-5 text-[15px] leading-7">
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
            rows={12}
            onChange={(event) => {
              const next = event.target.value;
              onChange(next);
              previewAfterPause(next.trim() !== "");
            }}
            placeholder="Add context, decisions, or acceptance criteria…"
            className="text-fg-primary placeholder:text-fg-secondary min-h-72 w-full resize-y bg-transparent px-1 py-5 text-[15px] leading-7"
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
          <div className="flex items-center gap-2">
            <span className="bg-border-subtle relative h-px w-12 overflow-hidden" aria-hidden>
              <span
                className="bg-accent-solid absolute inset-y-0 left-0"
                style={{ width: `${String((done / subtasks.length) * 100)}%` }}
              />
            </span>
            <span
              className="text-fg-secondary font-mono text-[9px] tracking-[0.08em] uppercase"
              data-numeric
            >
              {done}/{subtasks.length} done
            </span>
          </div>
        )}
      </div>

      <div className="border-border-default bg-surface-card overflow-hidden rounded-md border">
        <ul className="divide-border-subtle divide-y">
          {subtasks.map((item, index) => (
            <li
              key={item.key}
              className="group grid grid-cols-[1.25rem_1.25rem_minmax(0,1fr)_1.75rem] items-center gap-2 px-3 py-2.5"
            >
              <span data-numeric className="text-fg-secondary font-mono text-[9px]">
                {String(index + 1).padStart(2, "0")}
              </span>
              <input
                type="checkbox"
                id={`checklist-${item.key}`}
                checked={item.done}
                onChange={(event) => {
                  const next = [...subtasks];
                  next[index] = { ...item, done: event.target.checked };
                  onChange(next);
                }}
                className="dui-checkbox dui-checkbox-sm border-border-strong bg-surface-card checked:border-accent-solid checked:bg-accent-solid size-4 shrink-0 rounded-sm"
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
                className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
                onClick={() => {
                  onChange(subtasks.filter((candidate) => candidate.key !== item.key));
                }}
              >
                <Trash2 size={13} aria-hidden />
              </IconButton>
            </li>
          ))}
        </ul>

        <div className="border-border-subtle grid grid-cols-[1.25rem_1.25rem_minmax(0,1fr)] items-center gap-2 border-t px-3 py-2.5">
          <span className="text-accent-fg font-mono text-[9px]">NEW</span>
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
  links,
  onFilesChange,
  onLinksChange,
}: {
  files: DraftFile[];
  links: DraftLink[];
  onFilesChange: (files: DraftFile[]) => void;
  onLinksChange: (links: DraftLink[]) => void;
}) {
  async function relocate(file: DraftFile) {
    if (file.id === null) return;
    try {
      const path = await ipc.pickFile();
      if (path === null) return;

      const moved = await ipc.fileRefRelocate(file.id, path);
      onFilesChange(
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

  async function linkFile() {
    try {
      const path = await ipc.pickFile();
      if (path === null) return;

      const displayName = path.split("/").pop() ?? path;
      onFilesChange([...files, { key: nextKey(), id: null, path, displayName, found: true }]);
    } catch (error) {
      notifyError(messageFor(error));
    }
  }

  return (
    <section aria-labelledby="attachments-heading" className="space-y-2">
      <PanelHeading id="attachments-heading">Attachments</PanelHeading>

      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-1">
        <div className="space-y-2">
          <h4 className="text-fg-secondary font-mono text-[9px] font-medium tracking-[0.1em] uppercase">
            Files / {String(files.length).padStart(2, "0")}
          </h4>
          {files.map((file) => (
            <div
              key={file.key}
              className={cn(
                "grid grid-cols-[1.5rem_minmax(0,1fr)_1.75rem] items-center gap-2 rounded-sm border px-3 py-2.5",
                file.found
                  ? "border-border-subtle bg-surface-card"
                  : "border-warning-border bg-warning-bg",
              )}
            >
              <span aria-hidden className="text-fg-secondary flex items-center justify-start">
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
                        onFilesChange(files.filter((candidate) => candidate.key !== file.key));
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
            aria-label="Link files"
            onClick={() => {
              void linkFile();
            }}
            className="border-border-default text-fg-secondary hover:bg-surface-sunken hover:text-fg-primary flex min-h-9 w-full cursor-default items-center gap-2 rounded-sm border px-3 text-left text-xs font-medium"
          >
            <Paperclip size={14} aria-hidden />
            <span className="flex-1">Link files</span>
            <span className="font-mono text-[9px] tracking-[0.08em] uppercase">Browse</span>
          </button>
        </div>

        <LinksColumn links={links} onChange={onLinksChange} />
      </div>
    </section>
  );
}

function LinksColumn({
  links,
  onChange,
}: {
  links: DraftLink[];
  onChange: (links: DraftLink[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function closeForm() {
    setAdding(false);
    setValue("");
    setError(null);
  }

  function addLink() {
    const url = normalizeWebUrl(value);
    if (url === null) {
      setError("Enter a valid web address, such as https://example.com.");
      return;
    }
    if (links.some((link) => link.url === url)) {
      setError("This link is already attached.");
      return;
    }

    onChange([...links, { key: nextKey(), id: null, url }]);
    closeForm();
  }

  return (
    <div className="space-y-2">
      <h4 className="text-fg-secondary font-mono text-[9px] font-medium tracking-[0.1em] uppercase">
        Links / {String(links.length).padStart(2, "0")}
      </h4>

      {links.map((link) => (
        <div
          key={link.key}
          className="border-border-subtle bg-surface-card grid grid-cols-[1.5rem_minmax(0,1fr)_1.75rem] items-center gap-2 rounded-sm border px-3 py-2.5"
        >
          <span aria-hidden className="text-fg-secondary flex items-center justify-start">
            <Link2 size={15} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="text-fg-primary block truncate text-sm font-medium">
              {webLinkName(link.url)}
            </span>
            <span className="text-fg-secondary block truncate text-2xs" title={link.url}>
              {link.url}
            </span>
          </span>

          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <IconButton label={`Actions for ${webLinkName(link.url)}`}>
                <MoreHorizontal size={14} aria-hidden />
              </IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <MenuContent>
                <MenuItem
                  onSelect={() => {
                    void ipc.openExternal(link.url).catch((openError: unknown) => {
                      notifyError(messageFor(openError));
                    });
                  }}
                >
                  <ExternalLink size={13} aria-hidden />
                  Open link
                </MenuItem>
                <MenuSeparator />
                <MenuItem
                  destructive
                  onSelect={() => {
                    onChange(links.filter((candidate) => candidate.key !== link.key));
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

      {adding ? (
        <form
          className="border-border-subtle bg-surface-column space-y-2 rounded-sm border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            addLink();
          }}
        >
          <input
            ref={(element) => {
              element?.focus();
            }}
            type="text"
            inputMode="url"
            value={value}
            aria-label="Link URL"
            aria-describedby={error === null ? undefined : "link-url-error"}
            placeholder="https://example.com"
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
            className="border-border-default bg-surface-card text-fg-primary placeholder:text-fg-secondary h-10 w-full rounded-md border px-3 text-sm"
          />
          {error === null ? null : (
            <p id="link-url-error" role="alert" className="text-danger-fg text-2xs">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="primary">
              Add link
            </Button>
            <Button type="button" size="sm" onClick={closeForm}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          aria-label="Add link"
          onClick={() => {
            setAdding(true);
          }}
          className="border-border-default text-fg-secondary hover:bg-surface-sunken hover:text-fg-primary flex min-h-9 w-full cursor-default items-center gap-2 rounded-sm border px-3 text-left text-xs font-medium"
        >
          <Link2 size={14} aria-hidden />
          <span className="flex-1">Add link</span>
          <span className="font-mono text-[9px] tracking-[0.08em] uppercase">Reference</span>
        </button>
      )}
    </div>
  );
}

/**
 * The shape every control in the rail shares.
 *
 * They were three different heights and two different radii, because each was
 * written where it was needed. In a 18rem column stacked four deep that reads as
 * a list of unrelated widgets rather than as one panel.
 */
const FIELD =
  "border-border-default bg-surface-card text-fg-primary h-10 w-full rounded-md border px-3 text-sm";

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
  const dueDescription = draft.dueDate === null ? "No due date" : describeDue(draft.dueDate);
  const dueTone =
    state === "overdue"
      ? "text-danger-fg"
      : state === "today" || state === "soon"
        ? "text-warning-fg"
        : "text-fg-secondary";

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

      {/* A task's status is the column it sits in. The custom menu changes the
          draft only; Save still performs the move. */}
      <ChoiceField
        id="task-status"
        label="Status"
        value={draft.columnId}
        options={columns.map((column, index) => ({
          value: column.id,
          label: column.name,
          index: String(index + 1).padStart(2, "0"),
        }))}
        onChange={(columnId) => {
          onChange({ columnId });
        }}
      />

      <ChoiceField
        id="task-priority"
        label="Priority"
        value={String(draft.priority)}
        options={PRIORITIES.map((level) => ({
          value: String(level.value),
          label: level.label,
          index: `P${String(level.value)}`,
          icon: level.icon,
          tone: level.tone,
        }))}
        onChange={(priority) => {
          onChange({ priority: Number(priority) });
        }}
      />

      <DatePicker
        id="task-due"
        label="Due date"
        value={draft.dueDate}
        onChange={(dueDate) => {
          onChange({ dueDate });
        }}
        description={dueDescription}
        descriptionClassName={dueTone}
      />

      <div className="space-y-1.5">
        <label
          htmlFor="task-estimate"
          className="text-fg-secondary block text-2xs font-semibold tracking-[0.08em] uppercase"
        >
          Estimate
        </label>
        <div className="relative">
          <Clock3
            size={14}
            strokeWidth={1.8}
            aria-hidden
            className="text-accent-fg pointer-events-none absolute top-1/2 left-3 -translate-y-1/2"
          />
          <input
            id="task-estimate"
            type="text"
            value={estimateDraft}
            placeholder="e.g. 1h 30m"
            aria-invalid={estimateError === null ? undefined : true}
            aria-describedby={estimateError === null ? "task-estimate-hint" : "task-estimate-error"}
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
            className={cn(FIELD, "placeholder:text-fg-secondary pr-12 pl-9")}
          />
          <span className="text-fg-secondary pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 font-mono text-[9px] tracking-[0.08em] uppercase">
            Time
          </span>
        </div>
        <p id="task-estimate-hint" className="text-fg-secondary text-2xs">
          Minutes, 1h 30m, or 2h
        </p>
        {estimateError === null ? null : (
          <p id="task-estimate-error" role="alert" className="text-danger-fg text-2xs">
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
  const tagColors = [
    "slate",
    "blue",
    "teal",
    "amber",
    "red",
    "plum",
  ] as const satisfies readonly ProjectColor[];
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState<ProjectColor>("blue");
  const [busy, setBusy] = useState(false);

  const chosen = selected
    .map((id) => available.find((label) => label.id === id))
    .filter((label): label is Label => label !== undefined);

  async function create() {
    const trimmed = name.trim();
    if (trimmed === "" || busy) return;

    setBusy(true);
    try {
      // Created immediately, unlike everything else in the editor. A label
      // belongs to the project rather than to this task, so Cancel has no
      // business deleting one that another task may already be using.
      const existing = available.find(
        (label) => label.name.toLowerCase() === trimmed.toLowerCase(),
      );
      const label =
        existing === undefined
          ? await ipc.labelCreate(projectId, { name: trimmed, color })
          : existing.color === color
            ? existing
            : await ipc.labelUpdate(existing.id, { name: existing.name, color });
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
      <div className="flex items-center justify-between">
        <PanelHeading>Tags</PanelHeading>
        <span data-numeric className="text-fg-secondary font-mono text-[9px] tracking-[0.1em]">
          {String(chosen.length).padStart(2, "0")} ATTACHED
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {chosen.map((label) => (
          <span
            key={label.id}
            className="text-fg-primary relative inline-grid min-h-7 grid-cols-[0.25rem_minmax(0,1fr)_1.75rem] items-center overflow-hidden rounded-sm border text-xs font-medium"
            style={{
              backgroundColor: labelColorVariable(label.color),
              borderColor: colorVariable(label.color),
            }}
          >
            <span
              aria-hidden
              className="h-full w-full"
              style={{ backgroundColor: colorVariable(label.color) }}
            />
            <span className="max-w-36 truncate px-2">{label.name}</span>
            <button
              type="button"
              aria-label={`Remove ${label.name}`}
              onClick={() => {
                onChange(selected.filter((id) => id !== label.id));
              }}
              className="border-border-subtle text-fg-secondary hover:bg-surface-raised hover:text-fg-primary flex size-7 cursor-default items-center justify-center border-l"
            >
              <X size={12} aria-hidden />
            </button>
          </span>
        ))}

        {adding ? null : (
          <button
            type="button"
            onClick={() => {
              setColor(tagColors[available.length % tagColors.length] ?? "blue");
              setAdding(true);
            }}
            className="border-border-default text-fg-secondary hover:bg-surface-sunken hover:text-fg-primary inline-flex min-h-7 cursor-default items-center gap-1.5 rounded-sm border px-2.5 text-2xs font-semibold tracking-[0.08em] uppercase"
          >
            <Plus size={11} aria-hidden />
            Add tag
          </button>
        )}
      </div>

      {adding ? (
        <div className="border-border-subtle bg-surface-column space-y-3 rounded-sm border p-3">
          <div className="relative">
            <span className="text-fg-secondary pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-[9px] tracking-[0.1em] uppercase">
              Tag
            </span>
            <input
              ref={(element) => {
                element?.focus();
              }}
              type="text"
              value={name}
              aria-label="Tag name"
              placeholder="Name this marker"
              maxLength={LIMITS.labelName}
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
              className={cn(FIELD, "placeholder:text-fg-secondary pr-3 pl-12")}
            />
          </div>

          <fieldset className="m-0 border-0 p-0">
            <legend className="text-fg-secondary mb-1.5 text-2xs font-semibold tracking-[0.08em] uppercase">
              Tag colour
            </legend>
            <div className="grid grid-cols-2 gap-1.5">
              {tagColors.map((option) => {
                const selectedColor = option === color;
                return (
                  <label
                    key={option}
                    className={cn(
                      "border-border-subtle bg-surface-card text-fg-secondary relative inline-grid min-h-8 cursor-default grid-cols-[1rem_minmax(0,1fr)_1rem] items-center gap-1.5 rounded-sm border px-2 text-2xs capitalize",
                      "focus-within:outline-focus-ring focus-within:outline-2 focus-within:outline-offset-1",
                      selectedColor
                        ? "border-border-strong text-fg-primary"
                        : "hover:bg-surface-sunken hover:text-fg-primary",
                    )}
                  >
                    <input
                      type="radio"
                      name="tag-color"
                      value={option}
                      checked={selectedColor}
                      onChange={() => {
                        setColor(option);
                      }}
                      className="sr-only"
                    />
                    <span
                      aria-hidden
                      className="flex size-3 items-center justify-center rounded-full"
                      style={{ backgroundColor: colorVariable(option) }}
                    />
                    <span>{option}</span>
                    {selectedColor ? (
                      <Check size={12} strokeWidth={2.5} aria-hidden className="text-accent-fg" />
                    ) : null}
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="flex gap-2">
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
            <Button
              size="sm"
              onClick={() => {
                setAdding(false);
                setName("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </RailPanel>
  );
}

const FOCUS_TIP_INTERVAL_MS = 12_000;

const FOCUS_TIPS = [
  "Careful work starts with a clear view.",
  "Clarity first. Heroics are expensive.",
  "One clear next step beats twelve ambitious maybes.",
  "Small steps. Fewer plot twists.",
  "Make it visible, then make it happen.",
  "Write it down. Your brain has enough tabs open.",
  "Done is a feature. Perfect is a recurring bug.",
  "Priorities: because everything cannot be on fire.",
  "Give the next step a name. Mystery is bad UX.",
  "Slow is smooth. Smooth ships before Friday.",
  "A tidy task is a favor to your future self.",
  "Plan enough to make tomorrow pleasantly boring.",
] as const;

/** A small, changing signature tucked into the rail rather than another panel. */
function FocusModeCard() {
  const [tipIndex, setTipIndex] = useState(0);
  const reduceMotion = useReducedMotion();
  const tip = FOCUS_TIPS[tipIndex] ?? FOCUS_TIPS[0];

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTipIndex((current) => (current + 1) % FOCUS_TIPS.length);
    }, FOCUS_TIP_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div aria-hidden className="relative -mr-6 -mb-7 h-28 overflow-hidden lg:-mr-7">
      <LogoMark size={144} className="text-accent-fg absolute -right-5 -bottom-8 opacity-[0.12]" />
      <div className="absolute inset-x-0 bottom-3 z-10 pr-32 text-right">
        <p className="text-fg-secondary font-mono text-[9px] font-medium tracking-[0.18em] uppercase">
          Atticus
        </p>
        <div className="relative mt-1.5 min-h-10 overflow-hidden">
          <AnimatePresence initial={false} mode="wait">
            <motion.p
              key={tip}
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -3 }}
              transition={{
                duration: reduceMotion ? 0 : 0.28,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="text-fg-secondary text-2xs leading-relaxed"
            >
              {tip}
            </motion.p>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
