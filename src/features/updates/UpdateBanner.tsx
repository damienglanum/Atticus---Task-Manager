import { Download, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/Button";
import type { UpdateStatus } from "@/lib/bindings/UpdateStatus";

interface UpdateBannerProps {
  status: UpdateStatus;
  restarting: boolean;
  onRestart: () => void;
}

export function UpdateBanner({ status, restarting, onRestart }: UpdateBannerProps) {
  if (status.state === "idle") return null;

  if (status.state === "downloading") {
    const percent =
      status.total === null || status.total === 0
        ? null
        : Math.min(100, Math.round((status.downloaded / status.total) * 100));

    return (
      <div
        role="status"
        className="border-accent-border bg-accent-bg text-accent-fg flex min-h-10 shrink-0 items-center gap-3 border-b px-5 text-xs"
      >
        <Download size={15} aria-hidden className="shrink-0" />
        <span className="font-medium">Downloading Atticus {status.version}…</span>
        <div
          role="progressbar"
          aria-label={`Downloading Atticus ${status.version}`}
          aria-valuemin={0}
          aria-valuemax={100}
          {...(percent === null ? {} : { "aria-valuenow": percent })}
          className="bg-surface-card h-1.5 min-w-24 flex-1 overflow-hidden rounded-full"
        >
          <div
            className="bg-accent-solid h-full rounded-full transition-[width]"
            style={{ width: percent === null ? "12%" : `${String(percent)}%` }}
          />
        </div>
        <span className="w-9 text-right tabular-nums">
          {percent === null ? "" : `${String(percent)}%`}
        </span>
      </div>
    );
  }

  return (
    <div
      role="status"
      className="border-accent-border bg-accent-bg text-accent-fg flex min-h-11 shrink-0 items-center justify-between gap-4 border-b px-5"
    >
      <div className="flex min-w-0 items-center gap-2 text-xs">
        <RotateCw size={15} aria-hidden className="shrink-0" />
        <span>
          <strong className="font-semibold">Atticus {status.version} is ready.</strong> Restart when
          it suits you—your data is already saved.
        </span>
      </div>
      <Button size="sm" variant="primary" onClick={onRestart} disabled={restarting}>
        {restarting ? "Restarting…" : "Restart to update"}
      </Button>
    </div>
  );
}
