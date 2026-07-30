import { AlertTriangle, X } from "lucide-react";

import { useToastStore } from "@/app/toast";
import { cn } from "@/lib/cn";

/**
 * A live region for confirmations and failures.
 *
 * `role="status"` with `aria-live="polite"` so a message is announced without
 * stealing focus mid-task. Errors carry an icon as well as colour and stay put
 * until dismissed.
 */
export function Toaster() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-4 flex w-80 flex-col gap-2"
      style={{ zIndex: "var(--z-toast)" }}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            "pointer-events-auto flex items-start gap-2 rounded-md border p-3 text-xs shadow-(--shadow-overlay)",
            toast.tone === "error"
              ? "border-danger-border bg-danger-bg text-danger-fg"
              : "border-border-default bg-surface-raised text-fg-primary",
          )}
        >
          {toast.tone === "error" ? (
            <AlertTriangle size={14} aria-hidden className="mt-px shrink-0" />
          ) : null}
          <div className="flex-1 space-y-1.5">
            <p className="break-words">{toast.message}</p>
            {toast.action ? (
              <button
                type="button"
                onClick={toast.action.run}
                className="text-accent-fg hover:bg-surface-sunken -mx-1 cursor-default rounded-sm px-1 py-0.5 font-medium underline underline-offset-2"
              >
                {toast.action.label}
              </button>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => {
              dismiss(toast.id);
            }}
            className="hover:bg-surface-sunken -mt-0.5 -mr-1 inline-flex size-5 shrink-0 cursor-default items-center justify-center rounded-sm"
          >
            <X size={12} aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
