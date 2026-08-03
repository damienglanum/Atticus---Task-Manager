import type { AppInfo } from "@/lib/bindings/AppInfo";
import type { DatabaseInfo } from "@/lib/bindings/DatabaseInfo";
import { formatBytes } from "@/lib/format";
import { SettingsBlock } from "./SettingsPrimitives";

interface DiagnosticsPanelProps {
  app: AppInfo;
  database: DatabaseInfo;
}

/**
 * Where the user's data lives, stated plainly.
 *
 * This is the whole interface until the board arrives in milestone 4 — it is
 * genuinely useful rather than a placeholder, and it is the same panel that
 * will live in Settings.
 */
export function DiagnosticsPanel({ app, database }: DiagnosticsPanelProps) {
  return (
    <>
      <SettingsBlock
        marker="01"
        title="Application"
        description="The installed Atticus build and the platform it is running on."
      >
        <dl className="border-border-default divide-border-subtle divide-y border-y">
          <Row label="Version" value={app.version} numeric />
          <Row label="Platform" value={app.platform} />
        </dl>
      </SettingsBlock>

      <SettingsBlock
        marker="02"
        title="Local database"
        description="The working database and its backup location. Paths are shown in full so they can be copied into diagnostics or Finder."
      >
        <dl className="border-border-default divide-border-subtle divide-y border-y">
          <Row label="Database" value={database.path ?? "In memory (no file)"} mono />
          <Row
            label="Size"
            value={database.sizeBytes === null ? "—" : formatBytes(database.sizeBytes)}
            numeric
          />
          <Row
            label="Schema version"
            value={`${String(database.schemaVersion)} of ${String(database.latestSchemaVersion)}`}
            numeric
          />
          <Row label="Backups" value={database.backupDirectory ?? "—"} mono />
          <Row label="Backups kept" value={String(database.backupCount)} numeric />
        </dl>
      </SettingsBlock>
    </>
  );
}

function Row({
  label,
  value,
  numeric = false,
  mono = false,
}: {
  label: string;
  value: string;
  numeric?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="grid gap-1 px-2 py-3 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-fg-secondary font-mono text-[9px] tracking-[0.08em] uppercase">
        {label}
      </dt>
      <dd
        className={`text-fg-primary min-w-0 text-xs [overflow-wrap:anywhere] ${mono ? "font-mono text-2xs" : ""}`}
        data-selectable
        {...(numeric ? { "data-numeric": "" } : {})}
      >
        {value}
      </dd>
    </div>
  );
}
