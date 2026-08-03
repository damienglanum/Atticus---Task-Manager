import type { AppInfo } from "@/lib/bindings/AppInfo";
import type { DatabaseInfo } from "@/lib/bindings/DatabaseInfo";
import { formatBytes } from "@/lib/format";

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
    <section
      aria-labelledby="diagnostics-heading"
      className="border-border-subtle border-y px-1 py-4"
    >
      <h2 id="diagnostics-heading" className="text-fg-primary text-sm font-semibold">
        Installation details
      </h2>
      <p className="text-fg-secondary mt-1 text-xs">
        Useful when checking a version or locating a local backup.
      </p>

      <dl className="border-border-subtle mt-4 divide-y divide-(--color-border-subtle) border-t">
        <Row label="Version" value={app.version} numeric />
        <Row label="Platform" value={app.platform} />
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
    </section>
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
    <div className="grid gap-1 py-2.5 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-4">
      <dt className="text-fg-secondary text-xs">{label}</dt>
      <dd
        className={`text-fg-primary min-w-0 break-all text-xs ${mono ? "font-mono text-2xs" : ""}`}
        data-selectable
        {...(numeric ? { "data-numeric": "" } : {})}
      >
        {value}
      </dd>
    </div>
  );
}
