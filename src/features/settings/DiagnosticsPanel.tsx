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
    <section aria-labelledby="diagnostics-heading" className="max-w-2xl">
      <h2
        id="diagnostics-heading"
        className="text-fg-secondary text-xs font-semibold tracking-[0.06em] uppercase"
      >
        Your data
      </h2>

      <dl className="border-border-subtle mt-3 divide-y divide-(--color-border-subtle) border-y">
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
    <div className="flex gap-4 py-2">
      <dt className="text-fg-secondary w-36 shrink-0">{label}</dt>
      <dd
        className={`text-fg-primary break-all ${mono ? "font-mono text-xs" : ""}`}
        data-selectable
        {...(numeric ? { "data-numeric": "" } : {})}
      >
        {value}
      </dd>
    </div>
  );
}
