import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SquareTerminal } from "lucide-react";

import { notifyError } from "@/app/toast";
import type { McpAccess } from "@/lib/bindings/McpAccess";
import type { McpSettings } from "@/lib/bindings/McpSettings";
import { cn } from "@/lib/cn";
import { describeAppError, toAppError } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { queryKeys } from "@/lib/query/keys";
import { SettingsBlock, SettingsStatus } from "./SettingsPrimitives";

const ACCESS: { value: McpAccess; code: string; label: string; detail: string }[] = [
  {
    value: "disabled",
    code: "00",
    label: "Off",
    detail: "No tasks, project-note bodies, or workspace metadata are available.",
  },
  {
    value: "read_only",
    code: "RO",
    label: "Read only",
    detail:
      "Clients may inspect tasks, workspace metadata, and full project-note bodies, but cannot change anything.",
  },
  {
    value: "read_write",
    code: "RW",
    label: "Read & write",
    detail:
      "Clients may read the workspace and change tasks or notes only inside projects created through AI Boards.",
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
      // App.tsx reads this exact cache entry to decide whether AI Boards is
      // present in the sidebar. Updating it here makes the security boundary
      // and its navigation affordance change together.
      client.setQueryData(queryKeys.mcpSettings(), updated);
    },
    onError: (error: unknown) => {
      notifyError(`AI access could not be saved. ${describeAppError(toAppError(error))}`);
    },
  });

  const value = settings.data;

  function setAccess(access: McpAccess) {
    if (value === undefined || value.access === access) return;
    save.mutate({
      access,
      allowFileAttachments: access === "read_write" && value.allowFileAttachments,
    });
  }

  return (
    <div className="border-border-default mt-7 border-t">
      <SettingsBlock
        marker="01"
        title="Access policy"
        description="Atticus enforces this boundary on every tool call, even when the connected client asks for more. Changes take effect immediately."
      >
        {settings.isError ? (
          <p role="alert" className="text-danger-fg text-xs">
            AI access could not be read.
          </p>
        ) : value === undefined ? (
          <p role="status" className="text-fg-secondary text-xs">
            Reading AI access…
          </p>
        ) : (
          <fieldset
            className="border-border-default m-0 max-w-3xl border-x-0 border-y border-solid p-0"
            disabled={save.isPending}
          >
            <legend className="sr-only">MCP access level</legend>
            {ACCESS.map((choice) => {
              const selected = value.access === choice.value;
              return (
                <label
                  key={choice.value}
                  className={cn(
                    "border-border-subtle relative grid w-full cursor-default grid-cols-[2rem_minmax(0,1fr)_1rem] items-center gap-3 border-b px-3 py-3 text-left last:border-b-0",
                    "has-disabled:pointer-events-none has-disabled:opacity-50",
                    "has-focus-visible:outline-focus-ring has-focus-visible:outline-2 has-focus-visible:-outline-offset-2",
                    selected ? "bg-surface-sunken" : "hover:bg-surface-column",
                  )}
                >
                  <input
                    type="radio"
                    name="mcp-access"
                    value={choice.value}
                    checked={selected}
                    onChange={() => {
                      setAccess(choice.value);
                    }}
                    className="sr-only"
                  />
                  <span
                    aria-hidden
                    className={cn(
                      "font-mono text-2xs font-medium tracking-[0.08em]",
                      selected ? "text-accent-fg" : "text-fg-secondary",
                    )}
                  >
                    {choice.code}
                  </span>
                  <span className="min-w-0">
                    <span className="text-fg-primary block text-xs font-semibold">
                      {choice.label}
                    </span>
                    <span className="text-fg-secondary mt-0.5 block text-2xs">{choice.detail}</span>
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      "border-border-strong flex size-4 items-center justify-center rounded-full border",
                      selected && "border-accent-fg",
                    )}
                  >
                    {selected ? <span className="bg-accent-fg size-2 rounded-full" /> : null}
                  </span>
                  {selected ? (
                    <span aria-hidden className="bg-accent-solid absolute inset-y-2 left-0 w-0.5" />
                  ) : null}
                </label>
              );
            })}
          </fieldset>
        )}

        <div className="border-accent-fg mt-5 max-w-3xl border-l-2 py-0.5 pl-4">
          <p className="text-accent-fg font-mono text-2xs font-semibold tracking-[0.08em] uppercase">
            AI Boards boundary
          </p>
          <p className="text-fg-secondary mt-1 text-xs leading-relaxed">
            MCP can create and change tasks and project notes only in projects it created itself.
            Existing and user-created projects remain write-protected, including when Read &amp;
            write is active.
          </p>
        </div>
      </SettingsBlock>

      <SettingsBlock
        marker="02"
        title="File references"
        description="A separate safeguard for attaching paths. The server can reference an existing file inside the task project's configured folder, but it never reads or uploads the contents."
        status={
          value?.access === "read_write" ? undefined : (
            <span className="text-fg-secondary font-mono text-2xs tracking-[0.05em] uppercase">
              Requires read &amp; write
            </span>
          )
        }
      >
        <label
          className={cn(
            "border-border-default inline-flex min-h-9 items-center gap-3 rounded-md border px-3 text-xs",
            value?.access === "read_write"
              ? "bg-surface-app text-fg-primary"
              : "bg-surface-sunken text-fg-secondary opacity-60",
          )}
        >
          <input
            type="checkbox"
            checked={value?.allowFileAttachments ?? false}
            disabled={value?.access !== "read_write" || save.isPending}
            onChange={(event) => {
              if (value === undefined) return;
              save.mutate({ ...value, allowFileAttachments: event.target.checked });
            }}
            className="dui-checkbox dui-checkbox-sm border-border-strong rounded-sm"
          />
          Allow AI to add file references
        </label>
      </SettingsBlock>

      <SettingsBlock
        marker="03"
        title="Model instructions"
        description="Every connection receives the Atticus workflow guide automatically: inspect before writing, preserve task and note context, and mark work Done only after verification succeeds."
        status={<SettingsStatus>Included</SettingsStatus>}
      />

      <SettingsBlock
        marker="04"
        title="Client connection"
        description="Register Atticus as a local stdio server in Codex, Claude, or another MCP client using the executable and arguments below."
        status={<SettingsStatus>Local stdio</SettingsStatus>}
      >
        {launch.isError ? (
          <p role="alert" className="text-danger-fg text-xs">
            The local launch configuration could not be read.
          </p>
        ) : launch.data === undefined ? (
          <p role="status" className="text-fg-secondary text-xs">
            Locating Atticus…
          </p>
        ) : (
          <div className="border-border-default bg-surface-sunken max-w-4xl overflow-hidden rounded-md border">
            <div className="border-border-subtle text-fg-secondary flex items-center justify-between gap-4 border-b px-3 py-2 font-mono text-[9px] tracking-[0.1em] uppercase">
              <span className="flex items-center gap-2">
                <SquareTerminal size={12} strokeWidth={1.75} aria-hidden />
                Server definition
              </span>
              <span>stdio / local</span>
            </div>
            <dl className="divide-border-subtle divide-y">
              <ConnectionRow label="Command" value={launch.data.command} />
              <ConnectionRow label="Arguments" value={launch.data.args.join(" ")} />
            </dl>
          </div>
        )}
      </SettingsBlock>
    </div>
  );
}

function ConnectionRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 px-3 py-2.5 sm:grid-cols-[6rem_minmax(0,1fr)] sm:items-baseline sm:gap-4">
      <dt className="text-fg-secondary font-mono text-[9px] tracking-[0.08em] uppercase">
        {label}
      </dt>
      <dd className="text-fg-primary min-w-0 break-all font-mono text-2xs" data-selectable>
        {value}
      </dd>
    </div>
  );
}
