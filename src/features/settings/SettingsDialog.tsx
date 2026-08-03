import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  DatabaseBackup,
  HardDrive,
  Info,
  Palette,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";

import { notify, notifyError } from "@/app/toast";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import type { Project } from "@/lib/bindings/Project";
import type { ThemePreference } from "@/lib/bindings/ThemePreference";
import { cn } from "@/lib/cn";
import { describeAppError, toAppError } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/query/keys";
import { DataPanel } from "./DataPanel";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { ThemeControl } from "./ThemeControl";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  themePending: boolean;
  projects: Project[];
  /** Called after an import or restore, which replaces everything on screen. */
  onDataReplaced: () => void;
}

type SettingsSection = "general" | "data" | "about";

const SECTIONS: { id: SettingsSection; label: string; icon: LucideIcon }[] = [
  { id: "general", label: "General", icon: SlidersHorizontal },
  { id: "data", label: "Data", icon: HardDrive },
  { id: "about", label: "About", icon: Info },
];

export function SettingsDialog({
  open,
  onOpenChange,
  theme,
  onThemeChange,
  themePending,
  projects,
  onDataReplaced,
}: SettingsDialogProps) {
  const client = useQueryClient();
  const [section, setSection] = useState<SettingsSection>("general");

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
      await client.invalidateQueries({ queryKey: queryKeys.backups() });
    },
    onError: (error: unknown) => {
      notifyError(`Backup failed. ${describeAppError(toAppError(error))}`);
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Settings"
      description="Personalize Atticus and manage the data stored on this device."
      contentClassName="w-[min(52rem,calc(100vw-2rem))]"
    >
      <div className="grid min-h-[29rem] gap-5 md:grid-cols-[10rem_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="md:border-border-subtle md:border-r md:pr-4">
          <ul className="flex gap-1 md:flex-col">
            {SECTIONS.map((item) => {
              const Icon = item.icon;
              const selected = section === item.id;

              return (
                <li key={item.id} className="min-w-0 flex-1 md:flex-none">
                  <button
                    type="button"
                    aria-current={selected ? "page" : undefined}
                    onClick={() => {
                      setSection(item.id);
                    }}
                    className={cn(
                      "flex w-full cursor-default items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm",
                      "transition-colors duration-(--duration-fast)",
                      selected
                        ? "bg-accent-bg text-accent-fg font-medium"
                        : "text-fg-secondary hover:bg-surface-sunken hover:text-fg-primary",
                    )}
                  >
                    <Icon size={15} aria-hidden className="shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="min-w-0">
          {section === "general" ? (
            <div className="space-y-4">
              <SettingsPageHeader
                title="General"
                description="Choose how Atticus looks and receives new versions."
              />

              <div className="border-border-subtle divide-y divide-(--color-border-subtle) border-y">
                <SettingsCard
                  icon={Palette}
                  title="Appearance"
                  description="Use a light or dark theme, or follow your system setting."
                >
                  <ThemeControl value={theme} onChange={onThemeChange} busy={themePending} />
                </SettingsCard>

                <SettingsCard
                  icon={RefreshCw}
                  title="Automatic updates"
                  description="Atticus checks at launch and every 30 minutes, downloads signed updates in the background, and asks before restarting."
                  badge={
                    <span className="text-accent-fg inline-flex items-center gap-1 text-2xs font-medium">
                      <CheckCircle2 size={11} aria-hidden />
                      Main channel
                    </span>
                  }
                />
              </div>
            </div>
          ) : section === "data" ? (
            <div className="space-y-4">
              <SettingsPageHeader
                title="Data"
                description="Back up, export, import, or restore your local workspace."
              />

              <div className="border-border-subtle border-y">
                <SettingsCard
                  icon={DatabaseBackup}
                  title="Create a backup"
                  description="Write a timestamped copy beside the database. Manual backups are never pruned."
                  badge={
                    <Button
                      size="sm"
                      onClick={() => {
                        backup.mutate();
                      }}
                      disabled={backup.isPending}
                    >
                      {backup.isPending ? "Backing up…" : "Back up now"}
                    </Button>
                  }
                />
              </div>

              <DataPanel projects={projects} onDataReplaced={onDataReplaced} />
            </div>
          ) : (
            <div className="space-y-4">
              <SettingsPageHeader
                title="About"
                description="Version, platform, and local storage details for this installation."
              />

              {appInfo.data !== undefined && databaseInfo.data !== undefined ? (
                <DiagnosticsPanel app={appInfo.data} database={databaseInfo.data} />
              ) : databaseInfo.isError || appInfo.isError ? (
                <p role="alert" className="text-danger-fg text-xs">
                  Couldn&rsquo;t read the application details.
                </p>
              ) : (
                <p role="status" className="text-fg-secondary text-xs">
                  Reading application details…
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function SettingsPageHeader({ title, description }: { title: string; description: string }) {
  return (
    <header className="pb-1">
      <h2 className="text-fg-primary text-lg font-semibold">{title}</h2>
      <p className="text-fg-secondary mt-1 text-xs">{description}</p>
    </header>
  );
}

function SettingsCard({
  icon: Icon,
  title,
  description,
  badge,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  badge?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="py-4">
      <div className="flex items-start gap-3">
        <span className="text-accent-fg flex size-6 shrink-0 items-center justify-center">
          <Icon size={15} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-fg-primary text-sm font-semibold">{title}</h3>
            {badge}
          </div>
          <p className="text-fg-secondary mt-1 max-w-xl text-xs">{description}</p>
          {children === undefined ? null : <div className="mt-4">{children}</div>}
        </div>
      </div>
    </section>
  );
}
