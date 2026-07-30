import { useQuery } from "@tanstack/react-query";

import type { AppError } from "@/lib/bindings/AppError";
import { describeAppError } from "@/lib/errors";
import { formatBytes } from "@/lib/format";
import { ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/query/keys";

/**
 * Shown when the database could not be opened.
 *
 * The whole point of this screen is to answer one question — "where is my data
 * now?" — so paths are the most prominent thing on it, selectable, and never
 * truncated.
 *
 * The backup list is part of that answer, which is why `backups_list` is the one
 * command that does not require a working database: needing one in order to be
 * told where your backups are is exactly backwards.
 */
export function RecoveryScreen({ error }: { error: AppError }) {
  const backupPath = error.kind === "migration" ? error.backupPath : null;

  const backups = useQuery({
    queryKey: queryKeys.backups(),
    queryFn: () => ipc.backupsList(),
    // A failed startup is not a reason to retry a read that is only informative;
    // a spinning list would sit on top of the message that matters.
    retry: false,
  });

  return (
    <div role="alert" className="mx-auto max-w-2xl py-12">
      <h2 className="text-lg font-semibold">Atticus couldn&rsquo;t open your database.</h2>

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

      {backups.data !== undefined && backups.data.length > 0 ? (
        <div className="border-border-default bg-surface-card mt-6 rounded-md border p-4">
          <p className="font-medium">
            {backups.data.length === 1
              ? "There is 1 backup on this machine."
              : `There are ${String(backups.data.length)} backups on this machine.`}
          </p>
          <p className="text-fg-secondary mt-1">
            Each one is a complete, standalone database. Quit Atticus and copy the one you want over
            your database file to go back to it — the exact steps are in the documentation under
            &ldquo;Restoring by hand&rdquo;.
          </p>

          <ul className="mt-3 space-y-2">
            {backups.data.slice(0, 10).map((snapshot) => (
              <li key={snapshot.path}>
                <p
                  className="bg-surface-sunken text-fg-primary rounded-sm p-2 font-mono text-xs break-all"
                  data-selectable
                >
                  {snapshot.path}
                </p>
                <p className="text-fg-secondary mt-0.5 text-2xs">
                  {snapshot.manual ? "Taken by you" : "Taken automatically"} ·{" "}
                  <span data-numeric>{formatBytes(snapshot.sizeBytes)}</span>
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="text-fg-secondary mt-6 text-xs">
        Nothing was deleted. If this keeps happening, quit the application and copy the files above
        somewhere safe before trying again.
      </p>
    </div>
  );
}
