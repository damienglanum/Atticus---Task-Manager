import type { FileRef } from "@/lib/bindings/FileRef";
import type { LinkRef } from "@/lib/bindings/LinkRef";
import type { Subtask } from "@/lib/bindings/Subtask";
import type { TaskDetail } from "@/lib/bindings/TaskDetail";
import type { TaskPatch } from "@/lib/bindings/TaskPatch";

/**
 * The editor's draft, and how it turns back into commands.
 *
 * v1.0 had no draft: every field wrote on its own, and the editor's only job was
 * to flush whatever was mid-debounce before it closed. v1.1 has Cancel, and a
 * Cancel that leaves your edits on disk is a lie — so the whole task now lives
 * in memory until you press Save.
 *
 * Everything the editor can change is in here, including subtasks, file
 * references, and web links, which are separate rows with their own commands.
 * It would have been far less code to leave those writing immediately and only buffer the
 * task's own columns, and it would have made Cancel wrong for exactly the two
 * things a checklist is most used for: ticking something off, and undoing that.
 */

/** A checklist item in the draft. `id` is null until it has been written. */
export interface DraftSubtask {
  /** Stable across renders, including before the row exists. */
  key: string;
  id: string | null;
  title: string;
  done: boolean;
}

/** A linked file in the draft. `id` is null for one chosen but not yet saved. */
export interface DraftFile {
  key: string;
  id: string | null;
  path: string;
  displayName: string;
  found: boolean;
}

/** A web link in the draft. `id` is null until Save writes it. */
export interface DraftLink {
  key: string;
  id: string | null;
  url: string;
}

export interface TaskDraft {
  title: string;
  description: string;
  priority: number;
  dueDate: string | null;
  estimateMinutes: number | null;
  columnId: string;
  labelIds: string[];
  subtasks: DraftSubtask[];
  files: DraftFile[];
  links: DraftLink[];
}

export function draftFrom(detail: TaskDetail): TaskDraft {
  return {
    title: detail.task.title,
    description: detail.task.description,
    priority: detail.task.priority,
    dueDate: detail.task.dueDate,
    estimateMinutes: detail.task.estimateMinutes,
    columnId: detail.task.columnId,
    labelIds: [...detail.labelIds],
    subtasks: detail.subtasks.map(subtaskToDraft),
    files: detail.fileRefs.map(fileToDraft),
    links: detail.linkRefs.map(linkToDraft),
  };
}

function subtaskToDraft(subtask: Subtask): DraftSubtask {
  return { key: subtask.id, id: subtask.id, title: subtask.title, done: subtask.done };
}

function fileToDraft(fileRef: FileRef): DraftFile {
  return {
    key: fileRef.id,
    id: fileRef.id,
    path: fileRef.path,
    displayName: fileRef.displayName,
    found: fileRef.found,
  };
}

function linkToDraft(linkRef: LinkRef): DraftLink {
  return { key: linkRef.id, id: linkRef.id, url: linkRef.url };
}

/** True when the draft differs from what was loaded. Drives the dirty guard. */
export function isDirty(original: TaskDraft, draft: TaskDraft): boolean {
  return (
    original.title !== draft.title ||
    original.description !== draft.description ||
    original.priority !== draft.priority ||
    original.dueDate !== draft.dueDate ||
    original.estimateMinutes !== draft.estimateMinutes ||
    original.columnId !== draft.columnId ||
    !sameSet(original.labelIds, draft.labelIds) ||
    subtaskChanges(original, draft).length > 0 ||
    fileChanges(original, draft).length > 0 ||
    linkChanges(original, draft).length > 0
  );
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}

/**
 * The task's own columns, as one patch.
 *
 * Returns `null` when nothing on the task itself changed, so the caller can skip
 * the round trip rather than stamping `updated_at` for a save that only moved a
 * checklist item.
 */
export function taskPatch(original: TaskDraft, draft: TaskDraft): TaskPatch | null {
  const patch: TaskPatch = {};

  if (draft.title !== original.title) patch.title = draft.title;
  if (draft.description !== original.description) patch.description = draft.description;
  if (draft.priority !== original.priority) patch.priority = draft.priority;

  if (draft.dueDate !== original.dueDate) {
    // The nullable fields carry an explicit `clear_` companion rather than a
    // null, because "absent" already means "leave it alone" on this patch.
    if (draft.dueDate === null) patch.clearDueDate = true;
    else patch.dueDate = draft.dueDate;
  }

  if (draft.estimateMinutes !== original.estimateMinutes) {
    if (draft.estimateMinutes === null) patch.clearEstimate = true;
    else patch.estimateMinutes = draft.estimateMinutes;
  }

  return Object.keys(patch).length === 0 ? null : patch;
}

export type SubtaskChange =
  | { kind: "create"; title: string; done: boolean }
  | { kind: "update"; id: string; title?: string; done?: boolean }
  | { kind: "delete"; id: string };

/** What has to happen to the checklist rows to make the draft true. */
export function subtaskChanges(original: TaskDraft, draft: TaskDraft): SubtaskChange[] {
  const changes: SubtaskChange[] = [];
  const before = new Map(
    original.subtasks.filter((item) => item.id !== null).map((item) => [item.id, item]),
  );

  for (const item of draft.subtasks) {
    if (item.id === null) {
      // A blank row the user added and never typed into is not a subtask.
      if (item.title.trim() !== "") {
        changes.push({ kind: "create", title: item.title.trim(), done: item.done });
      }
      continue;
    }

    const existing = before.get(item.id);
    if (existing === undefined) continue;

    const change: SubtaskChange = { kind: "update", id: item.id };
    let touched = false;
    if (item.title.trim() !== existing.title) {
      change.title = item.title.trim();
      touched = true;
    }
    if (item.done !== existing.done) {
      change.done = item.done;
      touched = true;
    }
    if (touched) changes.push(change);
  }

  const kept = new Set(draft.subtasks.map((item) => item.id));
  for (const id of before.keys()) {
    if (id !== null && !kept.has(id)) changes.push({ kind: "delete", id });
  }

  return changes;
}

export type FileChange = { kind: "add"; path: string } | { kind: "remove"; id: string };

/** What has to happen to the file-reference rows to make the draft true. */
export function fileChanges(original: TaskDraft, draft: TaskDraft): FileChange[] {
  const changes: FileChange[] = [];

  for (const file of draft.files) {
    if (file.id === null) changes.push({ kind: "add", path: file.path });
  }

  const kept = new Set(draft.files.map((file) => file.id));
  for (const file of original.files) {
    if (file.id !== null && !kept.has(file.id)) changes.push({ kind: "remove", id: file.id });
  }

  return changes;
}

export type LinkChange = { kind: "add"; url: string } | { kind: "remove"; id: string };

/** What has to happen to web-link rows to make the draft true. */
export function linkChanges(original: TaskDraft, draft: TaskDraft): LinkChange[] {
  const changes: LinkChange[] = [];

  for (const link of draft.links) {
    if (link.id === null) changes.push({ kind: "add", url: link.url });
  }

  const kept = new Set(draft.links.map((link) => link.id));
  for (const link of original.links) {
    if (link.id !== null && !kept.has(link.id)) changes.push({ kind: "remove", id: link.id });
  }

  return changes;
}
