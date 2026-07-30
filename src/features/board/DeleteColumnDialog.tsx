import { useState } from "react";

import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { Column } from "@/lib/bindings/Column";
import type { ColumnDisposition } from "@/lib/bindings/ColumnDisposition";

interface DeleteColumnDialogProps {
  /** Mounted only while a column is being deleted; see the call site. */
  column: Column;
  /** Every other column on the board, as move targets. */
  otherColumns: Column[];
  taskCount: number | undefined;
  countFailed: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (disposition: ColumnDisposition) => void;
  pending: boolean;
}

/**
 * Deleting a column, with an explicit decision about the work inside it.
 *
 * An empty column is a simple confirmation. A column with tasks in it forces a
 * choice, states the exact count, and defaults to moving rather than deleting —
 * the reversible option is the one a mis-click should land on (US-6 AC3).
 */
export function DeleteColumnDialog({
  column,
  otherColumns,
  taskCount,
  countFailed,
  onOpenChange,
  onConfirm,
  pending,
}: DeleteColumnDialogProps) {
  // Move is the default: a mis-click should land on the reversible option.
  const [choice, setChoice] = useState<"move" | "delete">("move");
  const [targetId, setTargetId] = useState(otherColumns[0]?.id ?? "");

  const knownCount = taskCount ?? 0;
  const hasTasks = knownCount > 0;
  const noun = knownCount === 1 ? "task" : "tasks";

  // Until the count is known the confirm button stays disabled, and a failed
  // count keeps it disabled: deleting a column whose contents we could not read
  // is exactly the case where a wrong guess costs the user work.
  const ready = taskCount !== undefined && !countFailed;
  const targetMissing = hasTasks && choice === "move" && targetId === "";

  function confirm() {
    if (!hasTasks || choice === "delete") {
      onConfirm({ kind: "deleteTasks" });
      return;
    }
    onConfirm({ kind: "moveTo", columnId: targetId });
  }

  return (
    <ConfirmDialog
      open
      onOpenChange={onOpenChange}
      title={`Delete “${column.name}”?`}
      confirmLabel={pending ? "Deleting…" : "Delete column"}
      confirmDisabled={pending || !ready || targetMissing}
      onConfirm={confirm}
    >
      {countFailed ? (
        <p className="text-danger-fg">
          The tasks in this column could not be counted, so it can&rsquo;t be deleted safely. Close
          this and try again.
        </p>
      ) : taskCount === undefined ? (
        <p className="text-fg-secondary">Checking what&rsquo;s in this column…</p>
      ) : hasTasks ? (
        <div className="space-y-3">
          <p className="text-fg-secondary">
            This column holds{" "}
            <strong className="text-fg-primary">
              {knownCount} {noun}
            </strong>
            . Choose what happens to them.
          </p>

          <fieldset className="space-y-2">
            <legend className="sr-only">What happens to the tasks</legend>

            {/*
              The select is a sibling of the label, not inside it. A form control
              nested in a label is ambiguous — clicks on it are also clicks on the
              label — and the ambiguity showed up as the chosen column silently
              not taking effect, sending the tasks to the default one instead.
            */}
            <div className="space-y-1.5">
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="disposition"
                  value="move"
                  checked={choice === "move"}
                  onChange={() => {
                    setChoice("move");
                  }}
                  className="mt-0.5"
                />
                <span className="text-fg-primary flex-1">Move them to another column</span>
              </label>

              <select
                value={targetId}
                disabled={choice !== "move"}
                onChange={(event) => {
                  setTargetId(event.target.value);
                }}
                aria-label="Column to move the tasks to"
                className="border-border-strong bg-surface-raised text-fg-primary ml-6 w-[calc(100%-1.5rem)] rounded-md border px-2 py-1 text-xs disabled:opacity-50"
              >
                {otherColumns.map((other) => (
                  <option key={other.id} value={other.id}>
                    {other.name}
                  </option>
                ))}
              </select>
            </div>

            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="disposition"
                value="delete"
                checked={choice === "delete"}
                onChange={() => {
                  setChoice("delete");
                }}
                className="mt-0.5"
              />
              <span className="text-fg-primary flex-1">
                Delete the {noun} too
                <span className="text-fg-secondary block">
                  Including anything archived in this column.
                </span>
              </span>
            </label>
          </fieldset>

          <p className="text-fg-secondary">You can undo this from the notification afterwards.</p>
        </div>
      ) : (
        <p className="text-fg-secondary">
          This column is empty. You can undo this from the notification afterwards.
        </p>
      )}
    </ConfirmDialog>
  );
}
