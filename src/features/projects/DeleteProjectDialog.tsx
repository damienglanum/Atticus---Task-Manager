import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { TextField } from "@/components/ui/Field";
import type { DeletedCounts } from "@/lib/bindings/DeletedCounts";
import type { Project } from "@/lib/bindings/Project";
import { ipc } from "@/lib/ipc";

interface DeleteProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
  onConfirm: (confirmName: string) => void;
  pending: boolean;
}

/**
 * The only irreversible action in the application, and the only one that asks
 * the user to type something.
 *
 * The counts are fetched, not estimated, so the dialog states exactly what will
 * be destroyed. The name check is enforced in the backend too — a confirmation
 * that only the UI knows about is decoration.
 */
export function DeleteProjectDialog({
  open,
  onOpenChange,
  project,
  onConfirm,
  pending,
}: DeleteProjectDialogProps) {
  const [typed, setTyped] = useState("");

  const counts = useQuery({
    queryKey: ["project-delete-preview", project.id],
    queryFn: () => ipc.projectDeletePreview(project.id),
    enabled: open,
  });

  // No reset effect: the caller mounts this only while it is open, so a fresh
  // mount already gives an empty field.
  const matches = typed.trim() === project.name;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete “${project.name}”?`}
      confirmLabel={pending ? "Deleting…" : "Delete permanently"}
      // Gated on `isSuccess`, not `!isPending`: a *failed* count query also
      // leaves `isPending` false, which would re-enable the button while the
      // dialog is telling the user deletion is blocked.
      confirmDisabled={!matches || pending || !counts.isSuccess}
      onConfirm={() => {
        onConfirm(typed);
      }}
    >
      <p className="text-fg-primary font-medium">This cannot be undone.</p>

      {counts.isPending ? (
        <p role="status">Counting what would be deleted…</p>
      ) : counts.isError ? (
        <p role="alert" className="text-danger-fg">
          Couldn&rsquo;t count this project&rsquo;s contents, so deletion is blocked. Close this and
          try again.
        </p>
      ) : (
        <CountList counts={counts.data} />
      )}

      <TextField
        label={`Type ${project.name} to confirm`}
        value={typed}
        onChange={(event) => {
          setTyped(event.target.value);
        }}
        autoComplete="off"
        spellCheck={false}
      />
    </ConfirmDialog>
  );
}

function CountList({ counts }: { counts: DeletedCounts }) {
  const rows: [string, number][] = [
    ["boards", counts.boards],
    ["columns", counts.columns],
    ["tasks", counts.tasks],
    ["subtasks", counts.subtasks],
    ["labels", counts.labels],
  ];

  return (
    <div className="border-border-default bg-surface-sunken rounded-md border p-3">
      <p className="mb-2">Deleting this project also deletes:</p>
      <ul className="space-y-0.5">
        {rows.map(([label, value]) => (
          <li key={label} className="flex justify-between">
            <span>{label}</span>
            <span className="text-fg-primary font-medium" data-numeric>
              {value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
