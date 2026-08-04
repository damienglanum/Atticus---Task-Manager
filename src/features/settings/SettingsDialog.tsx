import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, DatabaseBackup, HardDrive, Info, SlidersHorizontal } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";

import { notify, notifyError } from "@/app/toast";
import { BlurFade } from "@/components/magicui/BlurFade";
import { Button } from "@/components/ui/Button";
import { DialogPage } from "@/components/ui/Dialog";
import type { ColorPalette } from "@/lib/bindings/ColorPalette";
import type { Project } from "@/lib/bindings/Project";
import type { ThemePreference } from "@/lib/bindings/ThemePreference";
import { cn } from "@/lib/cn";
import { describeAppError, toAppError } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/query/keys";
import { DataPanel } from "./DataPanel";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { McpPanel } from "./McpPanel";
import { PaletteControl } from "./PaletteControl";
import { SettingsBlock, SettingsStatus } from "./SettingsPrimitives";
import { ThemeControl } from "./ThemeControl";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  theme: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  themePending: boolean;
  colorPalette: ColorPalette;
  onColorPaletteChange: (palette: ColorPalette) => void;
  colorPalettePending: boolean;
  projects: Project[];
  /** Called after an import or restore, which replaces everything on screen. */
  onDataReplaced: () => void;
}

type SettingsSection = "general" | "ai" | "data" | "about";

const SECTIONS: {
  id: SettingsSection;
  label: string;
  eyebrow: string;
  description: string;
  icon: LucideIcon;
}[] = [
  {
    id: "general",
    label: "General",
    eyebrow: "Workspace preferences",
    description: "Set the appearance and update behaviour for this copy of Atticus.",
    icon: SlidersHorizontal,
  },
  {
    id: "ai",
    label: "AI access",
    eyebrow: "Local MCP boundary",
    description: "Decide what connected AI clients may inspect or change on this device.",
    icon: Bot,
  },
  {
    id: "data",
    label: "Data",
    eyebrow: "Portable archive",
    description: "Back up, move, and restore the local workspace without a cloud account.",
    icon: HardDrive,
  },
  {
    id: "about",
    label: "About",
    eyebrow: "Installation record",
    description: "Version, platform, and storage details for this installation.",
    icon: Info,
  },
];

export function SettingsDialog({
  open,
  onOpenChange,
  theme,
  onThemeChange,
  themePending,
  colorPalette,
  onColorPaletteChange,
  colorPalettePending,
  projects,
  onDataReplaced,
}: SettingsDialogProps) {
  const client = useQueryClient();
  const [section, setSection] = useState<SettingsSection>("general");
  const activeSection = SECTIONS.find((item) => item.id === section);

  const appInfo = useQuery({
    queryKey: queryKeys.appInfo(),
    queryFn: () => ipc.appInfo(),
    enabled: open,
  });
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

  // `section` is a closed union backed by SECTIONS. Keeping the guard makes
  // that invariant explicit without relying on a non-null assertion.
  if (activeSection === undefined) return null;

  return (
    <DialogPage
      open={open}
      onOpenChange={onOpenChange}
      title="Settings"
      description="Personalize Atticus and manage the data stored on this device."
      breadcrumb={
        <p className="text-fg-secondary font-mono text-[9px] tracking-[0.12em] uppercase">
          Atticus / local preferences
        </p>
      }
      backLabel="Return to the workspace"
    >
      <div className="grid min-h-full md:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="border-border-subtle bg-surface-sidebar flex flex-col border-b md:sticky md:top-0 md:min-h-[calc(100vh-4rem)] md:border-r md:border-b-0">
          <div className="px-5 pt-7 pb-5">
            <p className="text-accent-fg font-mono text-2xs font-semibold tracking-[0.14em] uppercase">
              Preference index
            </p>
            <p className="text-fg-secondary mt-2 text-xs">Configuration for this working copy.</p>
          </div>

          <nav aria-label="Settings sections" className="border-border-subtle border-t">
            <ul className="grid grid-cols-2 md:block">
              {SECTIONS.map((item, index) => {
                const Icon = item.icon;
                const selected = section === item.id;

                return (
                  <li key={item.id} className="min-w-0">
                    <button
                      type="button"
                      aria-label={item.label}
                      aria-current={selected ? "page" : undefined}
                      onClick={() => {
                        setSection(item.id);
                      }}
                      className={cn(
                        "border-border-subtle relative grid w-full cursor-default grid-cols-[1.5rem_1.25rem_minmax(0,1fr)] items-center gap-2 border-b px-5 py-3.5 text-left text-sm",
                        "transition-colors duration-(--duration-fast)",
                        selected
                          ? "bg-surface-sunken text-fg-primary font-medium"
                          : "text-fg-secondary hover:bg-surface-sunken hover:text-fg-primary",
                      )}
                    >
                      <span
                        aria-hidden
                        data-numeric
                        className={cn(
                          "font-mono text-[9px] tracking-[0.08em]",
                          selected ? "text-accent-fg" : "text-fg-secondary",
                        )}
                      >
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <Icon
                        size={14}
                        strokeWidth={1.75}
                        aria-hidden
                        className={selected ? "text-accent-fg" : undefined}
                      />
                      <span className="truncate">{item.label}</span>
                      {selected ? (
                        <span
                          aria-hidden
                          className="bg-accent-solid absolute inset-y-2 left-0 w-0.5"
                        />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="border-border-subtle mt-auto hidden border-t px-5 py-5 md:block">
            <p className="text-fg-secondary font-mono text-[9px] tracking-[0.12em] uppercase">
              Atticus / local only
            </p>
            <p className="text-fg-secondary mt-2 text-2xs leading-relaxed">
              Preferences and workspace data remain on this device.
            </p>
          </div>
        </aside>

        <main className="min-w-0">
          <BlurFade key={section} className="min-h-full px-6 py-8 lg:px-10 xl:px-12">
            <div className="w-full">
              <SettingsPageHeader
                marker={String(SECTIONS.indexOf(activeSection) + 1).padStart(2, "0")}
                title={activeSection.label}
                eyebrow={activeSection.eyebrow}
                description={activeSection.description}
              />

              {section === "general" ? (
                <div className="border-border-default mt-7 border-t">
                  <SettingsBlock
                    marker="01"
                    title="Appearance"
                    description="Choose the workspace brightness and the colour pair used throughout Atticus."
                  >
                    <div className="space-y-6">
                      <div>
                        <p className="text-fg-secondary mb-2 font-mono text-[9px] tracking-[0.1em] uppercase">
                          Brightness
                        </p>
                        <ThemeControl value={theme} onChange={onThemeChange} busy={themePending} />
                      </div>
                      <div className="border-border-subtle border-t pt-5">
                        <p className="text-fg-secondary mb-2 font-mono text-[9px] tracking-[0.1em] uppercase">
                          Colour style
                        </p>
                        <PaletteControl
                          value={colorPalette}
                          onChange={onColorPaletteChange}
                          busy={colorPalettePending}
                        />
                      </div>
                    </div>
                  </SettingsBlock>

                  <SettingsBlock
                    marker="02"
                    title="Automatic updates"
                    description="Atticus checks at launch and every 30 minutes, downloads signed updates quietly, and asks before restarting."
                    status={<SettingsStatus>Main channel</SettingsStatus>}
                  />
                </div>
              ) : section === "ai" ? (
                <McpPanel />
              ) : section === "data" ? (
                <div className="border-border-default mt-7 border-t">
                  <SettingsBlock
                    marker="01"
                    title="Create a backup"
                    description="Write a timestamped database copy beside the workspace. Manual backups are never pruned."
                    status={<SettingsStatus>Local snapshot</SettingsStatus>}
                  >
                    <Button
                      size="sm"
                      onClick={() => {
                        backup.mutate();
                      }}
                      disabled={backup.isPending}
                    >
                      <DatabaseBackup size={13} aria-hidden />
                      {backup.isPending ? "Backing up…" : "Back up now"}
                    </Button>
                  </SettingsBlock>

                  <DataPanel projects={projects} onDataReplaced={onDataReplaced} />
                </div>
              ) : (
                <div className="border-border-default mt-7 border-t">
                  {appInfo.data !== undefined && databaseInfo.data !== undefined ? (
                    <DiagnosticsPanel app={appInfo.data} database={databaseInfo.data} />
                  ) : databaseInfo.isError || appInfo.isError ? (
                    <p
                      role="alert"
                      className="border-border-subtle text-danger-fg border-b py-6 text-xs"
                    >
                      Couldn&rsquo;t read the application details.
                    </p>
                  ) : (
                    <p
                      role="status"
                      className="border-border-subtle text-fg-secondary border-b py-6 text-xs"
                    >
                      Reading application details…
                    </p>
                  )}
                </div>
              )}
            </div>
          </BlurFade>
        </main>
      </div>
    </DialogPage>
  );
}

function SettingsPageHeader({
  marker,
  title,
  eyebrow,
  description,
}: {
  marker: string;
  title: string;
  eyebrow: string;
  description: string;
}) {
  return (
    <header className="border-border-default flex flex-wrap items-end justify-between gap-5 border-b pb-6">
      <div>
        <p className="text-accent-fg font-mono text-2xs font-semibold tracking-[0.14em] uppercase">
          {marker} / {eyebrow}
        </p>
        <h2 className="text-fg-primary mt-2 text-xl font-semibold tracking-[-0.025em]">{title}</h2>
      </div>
      <p className="text-fg-secondary max-w-md text-sm leading-relaxed lg:text-right">
        {description}
      </p>
    </header>
  );
}
