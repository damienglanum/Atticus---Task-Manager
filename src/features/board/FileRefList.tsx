import { AlertTriangle, FileSearch, FolderOpen, Paperclip, Plus, Trash2 } from "lucide-react";

import { Button, IconButton } from "@/components/ui/Button";
import type { FileRef } from "@/lib/bindings/FileRef";

interface FileRefListProps {
  fileRefs: FileRef[];
  onAdd: () => void;
  onReveal: (fileRef: FileRef) => void;
  onLocate: (fileRef: FileRef) => void;
  onRemove: (fileRef: FileRef) => void;
  busy: boolean;
}

/**
 * Links to files on disk. Never copies of them (ADR-0007).
 *
 * A reference whose file has gone says so, shows the path it remembers, and
 * offers to be pointed somewhere new (US-17 AC2) — rather than quietly failing
 * when it is clicked, which is what a link with no state would do.
 */
export function FileRefList({
  fileRefs,
  onAdd,
  onReveal,
  onLocate,
  onRemove,
  busy,
}: FileRefListProps) {
  return (
    <section aria-labelledby="files-heading" className="space-y-2">
      <h3
        id="files-heading"
        className="text-fg-secondary text-xs font-semibold tracking-[0.06em] uppercase"
      >
        Files
      </h3>

      {fileRefs.length === 0 ? (
        <p className="text-fg-tertiary text-xs">
          No files linked. Linking records the path — the file itself is never copied.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {fileRefs.map((fileRef) => (
            <li
              key={fileRef.id}
              className={`group flex items-start gap-2 rounded-md border px-2 py-1.5 ${
                fileRef.found
                  ? "border-border-subtle bg-surface-sunken"
                  : "border-warning-border bg-warning-bg"
              }`}
            >
              {fileRef.found ? (
                <Paperclip size={13} aria-hidden className="text-fg-tertiary mt-0.5 shrink-0" />
              ) : (
                <AlertTriangle size={13} aria-hidden className="text-warning-fg mt-0.5 shrink-0" />
              )}

              <div className="min-w-0 flex-1">
                <p className="text-fg-primary truncate text-xs">{fileRef.displayName}</p>
                {fileRef.found ? null : (
                  <>
                    <p className="text-warning-fg text-2xs">Missing — this file is not there now</p>
                    <p className="text-fg-tertiary font-mono text-2xs break-all">{fileRef.path}</p>
                  </>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-0.5">
                {fileRef.found ? (
                  <IconButton
                    label={`Show “${fileRef.displayName}” in Finder`}
                    disabled={busy}
                    onClick={() => {
                      onReveal(fileRef);
                    }}
                  >
                    <FolderOpen size={13} aria-hidden />
                  </IconButton>
                ) : (
                  <IconButton
                    label={`Locate “${fileRef.displayName}”`}
                    disabled={busy}
                    onClick={() => {
                      onLocate(fileRef);
                    }}
                  >
                    <FileSearch size={13} aria-hidden />
                  </IconButton>
                )}
                <IconButton
                  label={`Remove the link to “${fileRef.displayName}”`}
                  disabled={busy}
                  onClick={() => {
                    onRemove(fileRef);
                  }}
                >
                  <Trash2 size={12} aria-hidden />
                </IconButton>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Button onClick={onAdd} disabled={busy}>
        <Plus size={13} aria-hidden />
        Link a file
      </Button>
    </section>
  );
}
