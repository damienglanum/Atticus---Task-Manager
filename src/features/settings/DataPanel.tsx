import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { notify, notifyError } from "@/app/toast";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { TextField } from "@/components/ui/Field";
import type { ImportMode } from "@/lib/bindings/ImportMode";
import type { ImportPlan } from "@/lib/bindings/ImportPlan";
import type { Project } from "@/lib/bindings/Project";
import { formatBytes } from "@/lib/format";
import { messageFor, toAppError } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/query/keys";
import { describePlan } from "./importPlan";

interface DataPanelProps {
  projects: Project[];
  /** Everything downstream of the database has to be re-read after an import. */
  onDataReplaced: () => void;
}

/** Typed to confirm a replace, the same shape of gate as deleting a project. */
const REPLACE_WORD = "replace";

export function DataPanel({ projects, onDataReplaced }: DataPanelProps) {
  const client = useQueryClient();
  const [scope, setScope] = useState("everything");
  const [pending, setPending] = useState<{ path: string; plan: ImportPlan } | null>(null);
  const [issues, setIssues] = useState<{ path: string; message: string }[]>([]);
  const [restoring, setRestoring] = useState<{ path: string; fileName: string } | null>(null);

  const backups = useQuery({ queryKey: queryKeys.backups(), queryFn: () => ipc.backupsList() });

  const exporting = useMutation({
    mutationFn: async () => {
      const stamp = new Date().toISOString().slice(0, 10);
      const name = scope === "everything" ? "atticus" : "atticus-project";
      const destination = await ipc.pickExportDestination(`${name}-${stamp}.json`);
      // A cancelled dialog is not a failure, so it reports no error and no
      // success — it simply did not happen.
      if (destination === null) return null;

      return ipc.exportData(
        scope === "everything" ? { kind: "everything" } : { kind: "project", projectId: scope },
        destination,
      );
    },
    onSuccess: (path) => {
      if (path !== null) notify(`Exported to ${path}`);
    },
    onError: (error: unknown) => {
      notifyError(`Export failed. ${messageFor(error)}`);
    },
  });

  /** Reads the file and shows what it *would* do. Nothing is written here. */
  const preview = useMutation({
    mutationFn: async () => {
      const path = await ipc.pickImportFile();
      if (path === null) return null;
      return { path, plan: await ipc.importPreview(path) };
    },
    onSuccess: (result) => {
      if (result !== null) {
        setIssues([]);
        setPending(result);
      }
    },
    onError: (error: unknown) => {
      const app = toAppError(error);
      // A list of JSON paths belongs on screen, where it can be read, rather
      // than truncated into a toast.
      if (app.kind === "import_invalid") {
        setPending(null);
        setIssues(app.issues);
      } else {
        notifyError(`Couldn't read that file. ${messageFor(error)}`);
      }
    },
  });

  const applying = useMutation({
    mutationFn: ({ path, mode }: { path: string; mode: ImportMode }) => ipc.importApply(path, mode),
    onSuccess: async (result) => {
      setPending(null);
      notify(`Imported ${describePlan(result.created)}.`);
      await client.invalidateQueries();
      onDataReplaced();
    },
    onError: (error: unknown) => {
      const app = toAppError(error);
      if (app.kind === "import_invalid") {
        setPending(null);
        setIssues(app.issues);
      } else {
        notifyError(`Import failed. ${messageFor(error)}`);
      }
    },
  });

  const restore = useMutation({
    mutationFn: (path: string) => ipc.backupRestore(path),
    onSuccess: async (safety) => {
      setRestoring(null);
      notify(`Restored. The database it replaced was saved to ${safety}`);
      await client.invalidateQueries();
      onDataReplaced();
    },
    onError: (error: unknown) => {
      setRestoring(null);
      notifyError(`Restore failed. ${messageFor(error)}`);
    },
  });

  return (
    <section aria-labelledby="data-heading" className="space-y-4">
      <h3
        id="data-heading"
        className="text-fg-secondary text-xs font-semibold tracking-[0.06em] uppercase"
      >
        Export and import
      </h3>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-fg-secondary text-2xs">What to export</span>
          <select
            value={scope}
            onChange={(event) => {
              setScope(event.target.value);
            }}
            className="border-border-strong bg-surface-raised text-fg-primary h-8 rounded-md border px-2 text-xs"
          >
            <option value="everything">Everything</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>

        <Button
          onClick={() => {
            exporting.mutate();
          }}
          disabled={exporting.isPending}
        >
          {exporting.isPending ? "Exporting…" : "Export…"}
        </Button>

        <Button
          onClick={() => {
            preview.mutate();
          }}
          disabled={preview.isPending}
        >
          {preview.isPending ? "Reading…" : "Import…"}
        </Button>
      </div>

      <p className="text-fg-secondary text-2xs">
        Exports are JSON and include archived items. File references travel as paths, not contents,
        so a file imported on another machine will show as missing until you point at it again.
      </p>

      {issues.length > 0 ? <IssueList issues={issues} /> : null}

      {pending !== null ? (
        <ImportChoice
          plan={pending.plan}
          busy={applying.isPending}
          onCancel={() => {
            setPending(null);
          }}
          onChoose={(mode) => {
            applying.mutate({ path: pending.path, mode });
          }}
        />
      ) : null}

      <h3
        id="backups-heading"
        className="text-fg-secondary text-xs font-semibold tracking-[0.06em] uppercase"
      >
        Backups
      </h3>

      {backups.data === undefined ? (
        <p role="status" className="text-fg-secondary text-2xs">
          Reading backups…
        </p>
      ) : backups.data.length === 0 ? (
        <p className="text-fg-secondary text-2xs">
          No backups yet. One is taken automatically before any schema change or replace-import.
        </p>
      ) : (
        <ul aria-labelledby="backups-heading" className="divide-y divide-(--color-border-subtle)">
          {backups.data.slice(0, 10).map((snapshot) => (
            <li key={snapshot.path} className="flex items-center gap-3 py-1.5">
              <span className="min-w-0 flex-1">
                <span className="text-fg-primary block truncate font-mono text-2xs">
                  {snapshot.fileName}
                </span>
                <span className="text-fg-secondary text-2xs">
                  {snapshot.manual ? "Taken by you" : "Taken automatically"} ·{" "}
                  <span data-numeric>{formatBytes(snapshot.sizeBytes)}</span>
                </span>
              </span>
              <Button
                variant="secondary"
                onClick={() => {
                  setRestoring({ path: snapshot.path, fileName: snapshot.fileName });
                }}
              >
                Restore…
              </Button>
            </li>
          ))}
        </ul>
      )}

      {restoring !== null ? (
        <ConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next) setRestoring(null);
          }}
          title="Restore this backup?"
          confirmLabel="Restore"
          destructive
          confirmDisabled={restore.isPending}
          onConfirm={() => {
            restore.mutate(restoring.path);
          }}
        >
          <p>
            Everything currently in the database will be replaced by{" "}
            <span className="font-mono">{restoring.fileName}</span>.
          </p>
          <p className="mt-2">
            The database being replaced is backed up first, so this is reversible. If the backup
            turns out not to open, the current database is put back automatically.
          </p>
        </ConfirmDialog>
      ) : null}
    </section>
  );
}

/** The dry run. Neither button writes until it is pressed. */
function ImportChoice({
  plan,
  busy,
  onCancel,
  onChoose,
}: {
  plan: ImportPlan;
  busy: boolean;
  onCancel: () => void;
  onChoose: (mode: ImportMode) => void;
}) {
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [typed, setTyped] = useState("");

  return (
    <div className="border-border-strong rounded-md border p-3">
      <p className="text-fg-primary text-xs">
        This file will create <strong>{describePlan(plan)}</strong>.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          onClick={() => {
            onChoose("merge");
          }}
          disabled={busy}
        >
          {busy ? "Importing…" : "Add to what's here"}
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            setConfirmReplace(true);
          }}
          disabled={busy}
        >
          Replace everything…
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>

      <p className="text-fg-secondary mt-2 text-2xs">
        Adding never overwrites anything. Importing the same file twice creates a second copy —
        records are matched by identity, and names are not unique.
      </p>

      {confirmReplace ? (
        <ConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next) setConfirmReplace(false);
          }}
          title="Replace everything?"
          confirmLabel="Replace everything"
          destructive
          confirmDisabled={typed.trim() !== REPLACE_WORD || busy}
          onConfirm={() => {
            setConfirmReplace(false);
            onChoose("replace");
          }}
        >
          <p>
            Every project, board, task and label in this database will be deleted and replaced by{" "}
            {describePlan(plan)}.
          </p>
          <p className="mt-2">
            A backup is taken first, so this can be undone from the Backups list below.
          </p>
          <div className="mt-3">
            <TextField
              label={`Type ${REPLACE_WORD} to confirm`}
              value={typed}
              onChange={(event) => {
                setTyped(event.target.value);
              }}
            />
          </div>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

function IssueList({ issues }: { issues: { path: string; message: string }[] }) {
  return (
    <div role="alert" className="border-danger-border bg-danger-bg rounded-md border p-3">
      <p className="text-danger-fg text-xs font-semibold">
        That file wasn&rsquo;t imported. Nothing has been changed.
      </p>
      <ul className="mt-2 space-y-1">
        {issues.slice(0, 20).map((issue) => (
          <li key={`${issue.path}-${issue.message}`} className="text-fg-primary text-2xs">
            <span className="font-mono">{issue.path}</span> — {issue.message}
          </li>
        ))}
      </ul>
      {issues.length > 20 ? (
        <p className="text-fg-secondary mt-2 text-2xs">…and {String(issues.length - 20)} more.</p>
      ) : null}
    </div>
  );
}
