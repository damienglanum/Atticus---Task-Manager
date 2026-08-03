import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, FileLock2, ShieldCheck, SquareTerminal } from "lucide-react";

import { notifyError } from "@/app/toast";
import type { McpAccess } from "@/lib/bindings/McpAccess";
import type { McpSettings } from "@/lib/bindings/McpSettings";
import { cn } from "@/lib/cn";
import { describeAppError, toAppError } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/query/keys";

const ACCESS: { value: McpAccess; label: string; detail: string }[] = [
  { value: "disabled", label: "Off", detail: "No task data is available." },
  { value: "read_only", label: "Read only", detail: "AI can inspect and search." },
  {
    value: "read_write",
    label: "Read & write",
    detail: "AI can write inside AI Boards only.",
  },
];

export function McpPanel() {
  const client = useQueryClient();
  const settings = useQuery({
    queryKey: queryKeys.mcpSettings(),
    queryFn: () => ipc.mcpSettingsGet(),
  });
  const launch = useQuery({
    queryKey: queryKeys.mcpLaunchConfig(),
    queryFn: () => ipc.mcpLaunchConfig(),
  });
  const save = useMutation({
    mutationFn: (next: McpSettings) => ipc.mcpSettingsSet(next),
    onSuccess: (updated) => {
      client.setQueryData(queryKeys.mcpSettings(), updated);
    },
    onError: (error: unknown) => {
      notifyError(`AI access could not be saved. ${describeAppError(toAppError(error))}`);
    },
  });

  const value = settings.data;

  function setAccess(access: McpAccess) {
    if (value === undefined) return;
    save.mutate({
      access,
      allowFileAttachments: access === "read_write" && value.allowFileAttachments,
    });
  }

  return (
    <div className="border-border-subtle divide-y divide-(--color-border-subtle) border-y">
      <section className="py-4">
        <div className="flex items-start gap-3">
          <span className="text-accent-fg flex size-6 shrink-0 items-center justify-center">
            <ShieldCheck size={15} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-fg-primary text-sm font-semibold">Permission</h3>
            <p className="text-fg-secondary mt-1 text-xs">
              Atticus enforces this policy itself on every tool call, even if an AI client does not
              ask for confirmation.
            </p>
            <div className="border-accent-border bg-accent-bg mt-3 rounded-lg border px-3 py-2.5">
              <p className="text-accent-fg text-xs font-semibold">AI Boards sandbox</p>
              <p className="text-fg-secondary mt-1 text-2xs leading-relaxed">
                MCP can create and change work only in projects it created itself. Existing and
                user-created projects are always write-protected, even when Read &amp; write is on.
                You keep the normal create, rename, and remove controls inside AI Boards.
              </p>
            </div>

            {value === undefined ? (
              <p role="status" className="text-fg-secondary mt-4 text-xs">
                Reading AI access…
              </p>
            ) : (
              <div className="mt-4 grid gap-2 sm:grid-cols-3" aria-label="MCP access level">
                {ACCESS.map((choice) => {
                  const selected = value.access === choice.value;
                  return (
                    <button
                      key={choice.value}
                      type="button"
                      aria-pressed={selected}
                      disabled={save.isPending}
                      onClick={() => {
                        setAccess(choice.value);
                      }}
                      className={cn(
                        "min-h-16 rounded-lg border px-3 py-2 text-left transition-colors",
                        "disabled:pointer-events-none disabled:opacity-50",
                        selected
                          ? "border-accent-border bg-accent-bg"
                          : "border-border-subtle bg-surface-card hover:border-border-strong",
                      )}
                    >
                      <span
                        className={cn(
                          "block text-xs font-semibold",
                          selected ? "text-accent-fg" : "text-fg-primary",
                        )}
                      >
                        {choice.label}
                      </span>
                      <span className="text-fg-secondary mt-1 block text-2xs">{choice.detail}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="py-4">
        <div className="flex items-start gap-3">
          <span className="text-accent-fg flex size-6 shrink-0 items-center justify-center">
            <FileLock2 size={15} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-fg-primary text-sm font-semibold">File references</h3>
            <p className="text-fg-secondary mt-1 text-xs">
              A separate safeguard. The server can only reference existing files inside the task
              project&rsquo;s configured folder; it never reads or uploads their contents.
            </p>
            <label className="mt-3 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={value?.allowFileAttachments ?? false}
                disabled={value?.access !== "read_write" || save.isPending}
                onChange={(event) => {
                  if (value === undefined) return;
                  save.mutate({ ...value, allowFileAttachments: event.target.checked });
                }}
                className="accent-(--color-accent-solid) size-4"
              />
              <span className="text-fg-primary">Allow AI to add file references</span>
            </label>
          </div>
        </div>
      </section>

      <section className="py-4">
        <div className="flex items-start gap-3">
          <span className="text-accent-fg flex size-6 shrink-0 items-center justify-center">
            <CheckCircle2 size={15} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-fg-primary text-sm font-semibold">Workflow rules included</h3>
            <p className="text-fg-secondary mt-1 text-xs">
              Every connection receives Atticus instructions automatically: inspect before writing,
              start accepted work in In Progress, keep focus-mode details current, and move to Done
              only after verification succeeds.
            </p>
          </div>
        </div>
      </section>

      <section className="py-4">
        <div className="flex items-start gap-3">
          <span className="text-accent-fg flex size-6 shrink-0 items-center justify-center">
            <SquareTerminal size={15} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-fg-primary text-sm font-semibold">Connect an MCP client</h3>
            <p className="text-fg-secondary mt-1 text-xs">
              Add a local stdio server named Atticus in Codex, Claude, or another MCP client using
              this command and argument.
            </p>
            {launch.data === undefined ? (
              <p role="status" className="text-fg-secondary mt-3 text-xs">
                Locating Atticus…
              </p>
            ) : (
              <dl className="mt-3 grid gap-2 text-xs">
                <div className="grid gap-1 sm:grid-cols-[5rem_minmax(0,1fr)] sm:items-baseline">
                  <dt className="text-fg-secondary">Command</dt>
                  <dd>
                    <code className="bg-surface-sunken text-fg-primary block select-all overflow-x-auto rounded-md px-2 py-1.5">
                      {launch.data.command}
                    </code>
                  </dd>
                </div>
                <div className="grid gap-1 sm:grid-cols-[5rem_minmax(0,1fr)] sm:items-baseline">
                  <dt className="text-fg-secondary">Arguments</dt>
                  <dd>
                    <code className="bg-surface-sunken text-fg-primary block select-all rounded-md px-2 py-1.5">
                      {launch.data.args.join(" ")}
                    </code>
                  </dd>
                </div>
              </dl>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
