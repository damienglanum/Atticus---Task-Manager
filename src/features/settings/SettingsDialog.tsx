import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMutation } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { notify, notifyError } from "@/app/toast";
import type { Project } from "@/lib/bindings/Project";
import type { ThemePreference } from "@/lib/bindings/ThemePreference";
import type { UpdateChannel } from "@/lib/bindings/UpdateChannel";
import { describeAppError, toAppError } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/query/keys";
import { DataPanel } from "./DataPanel";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { ThemeControl } from "./ThemeControl";
import { UpdateChannelControl } from "./UpdateChannelControl";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  themePending: boolean;
  updateChannel: UpdateChannel;
  onUpdateChannelChange: (channel: UpdateChannel) => void;
  updateChannelPending: boolean;
  projects: Project[];
  /** Called after an import or restore, which replaces everything on screen. */
  onDataReplaced: () => void;
}

export function SettingsDialog({
  open,
  onOpenChange,
  theme,
  onThemeChange,
  themePending,
  updateChannel,
  onUpdateChannelChange,
  updateChannelPending,
  projects,
  onDataReplaced,
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

        <section>
          <h3 className="text-fg-secondary text-xs font-semibold tracking-[0.06em] uppercase">
            Automatic updates
          </h3>
          <div className="mt-2">
            <UpdateChannelControl
              value={updateChannel}
              onChange={onUpdateChannelChange}
              busy={updateChannelPending}
            />
          </div>
          <p className="text-fg-secondary mt-2 max-w-2xl text-2xs">
            Atticus checks at launch and every 30 minutes. Changing channel checks immediately. A
            signed update installs automatically and restarts the app.
          </p>
        </section>

        {appInfo.data !== undefined && databaseInfo.data !== undefined ? (
          <DiagnosticsPanel app={appInfo.data} database={databaseInfo.data} />
        ) : databaseInfo.isError || appInfo.isError ? (
          <p role="alert" className="text-danger-fg text-xs">
            Couldn&rsquo;t read the database details.
          </p>
        ) : (
          <p role="status" className="text-fg-secondary text-xs">
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
          <p className="text-fg-secondary mt-2 text-2xs">
            Writes a timestamped copy beside the database. A backup is also taken automatically
            before any schema change. Backups you take by hand are never pruned.
          </p>
        </section>

        <DataPanel projects={projects} onDataReplaced={onDataReplaced} />
      </div>
    </Dialog>
  );
}
