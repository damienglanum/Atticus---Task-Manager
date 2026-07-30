import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMutation } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { notify, notifyError } from "@/app/toast";
import type { ThemePreference } from "@/lib/bindings/ThemePreference";
import { describeAppError, toAppError } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/query/keys";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { ThemeControl } from "./ThemeControl";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  themePending: boolean;
}

export function SettingsDialog({
  open,
  onOpenChange,
  theme,
  onThemeChange,
  themePending,
}: SettingsDialogProps) {
  const client = useQueryClient();

  const appInfo = useQuery({ queryKey: queryKeys.appInfo(), queryFn: () => ipc.appInfo() });
  const databaseInfo = useQuery({
    queryKey: queryKeys.databaseInfo(),
    queryFn: () => ipc.databaseInfo(),
    enabled: open,
  });

  const backup = useMutation({
    mutationFn: () => ipc.backupCreate(),
    onSuccess: async (path) => {
      notify(`Backup written to ${path}`);
      await client.invalidateQueries({ queryKey: queryKeys.databaseInfo() });
    },
    onError: (error: unknown) => {
      notifyError(`Backup failed. ${describeAppError(toAppError(error))}`);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Settings">
      <div className="space-y-6">
        <section>
          <h3 className="text-fg-secondary text-xs font-semibold tracking-[0.06em] uppercase">
            Appearance
          </h3>
          <div className="mt-2">
            <ThemeControl value={theme} onChange={onThemeChange} busy={themePending} />
          </div>
        </section>

        {appInfo.data !== undefined && databaseInfo.data !== undefined ? (
          <DiagnosticsPanel app={appInfo.data} database={databaseInfo.data} />
        ) : databaseInfo.isError || appInfo.isError ? (
          <p role="alert" className="text-danger-fg text-xs">
            Couldn&rsquo;t read the database details.
          </p>
        ) : (
          <p role="status" className="text-fg-tertiary text-xs">
            Reading database details…
          </p>
        )}

        <section>
          <Button
            onClick={() => {
              backup.mutate();
            }}
            disabled={backup.isPending}
          >
            {backup.isPending ? "Backing up…" : "Back up now"}
          </Button>
          <p className="text-fg-tertiary mt-2 text-2xs">
            Writes a timestamped copy beside the database. A backup is also taken automatically
            before any schema change.
          </p>
        </section>
      </div>
    </Dialog>
  );
}
