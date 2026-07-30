import type { AppError } from "@/lib/bindings/AppError";
import { describeAppError } from "@/lib/errors";

/**
 * Shown when the database could not be opened.
 *
 * The whole point of this screen is to answer one question — "where is my data
 * now?" — so the backup path is the most prominent thing on it, selectable, and
 * never truncated.
 */
export function RecoveryScreen({ error }: { error: AppError }) {
  const backupPath = error.kind === "migration" ? error.backupPath : null;

  return (
    <div role="alert" className="mx-auto max-w-2xl py-12">
      <h2 className="text-lg font-semibold">Takenkanban couldn&rsquo;t open your database.</h2>

      <p className="text-fg-secondary mt-3">{describeAppError(error)}</p>

      {backupPath !== null && backupPath !== "" ? (
        <div className="border-border-default bg-surface-card mt-6 rounded-md border p-4">
          <p className="font-medium">Your data was backed up before this was attempted.</p>
          <p className="text-fg-secondary mt-1">
            The snapshot below was taken before any change was made, and the original database was
            left exactly as it was.
          </p>
          <p
            className="bg-surface-sunken text-fg-primary mt-3 rounded-sm p-2 font-mono text-xs break-all"
            data-selectable
          >
            {backupPath}
          </p>
        </div>
      ) : null}

      <p className="text-fg-tertiary mt-6 text-xs">
        Nothing was deleted. If this keeps happening, quit the application and copy the files above
        somewhere safe before trying again.
      </p>
    </div>
  );
}
